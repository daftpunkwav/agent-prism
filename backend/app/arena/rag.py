"""RAG 向量检索 — 轻量级内存向量存储。

实现功能：
1. 文本分块（按段落/句子）
2. 简单向量嵌入（基于 TF-IDF 风格的词袋 + 归一化）
3. 余弦相似度检索
4. 上下文压缩整合
"""

from __future__ import annotations

import math
import re
from collections import Counter


class SimpleVectorStore:
    """轻量级内存向量存储（无外部依赖）。"""

    def __init__(self) -> None:
        self.chunks: list[dict] = []
        self.vocab: dict[str, int] = {}
        self.idf: dict[str, float] = {}

    def _tokenize(self, text: str) -> list[str]:
        """简单分词：英文按空格，中文按字符"""
        text = text.lower().strip()
        # 保留中文字符、英文单词、数字
        tokens = re.findall(r"[a-z0-9]+|[一-鿿]", text)
        return tokens

    def _compute_idf(self, all_tokens: list[list[str]]) -> None:
        """计算 IDF（逆文档频率）。"""
        doc_count = len(all_tokens)
        df: Counter[str] = Counter()
        for tokens in all_tokens:
            unique = set(tokens)
            for token in unique:
                df[token] += 1
        for word, freq in df.items():
            self.idf[word] = math.log((doc_count + 1) / (freq + 1)) + 1

    def _embed(self, tokens: list[str]) -> dict[str, float]:
        """TF-IDF 嵌入。"""
        tf: Counter[str] = Counter(tokens)
        total = len(tokens) if tokens else 1
        vec = {}
        for word, count in tf.items():
            vec[word] = (count / total) * self.idf.get(word, 1.0)
        # 归一化
        norm = math.sqrt(sum(v * v for v in vec.values())) or 1.0
        for word in vec:
            vec[word] /= norm
        return vec

    def _cosine(self, vec_a: dict, vec_b: dict) -> float:
        """稀疏向量余弦相似度。"""
        keys = set(vec_a.keys()) & set(vec_b.keys())
        if not keys:
            return 0.0
        dot = sum(vec_a[k] * vec_b[k] for k in keys)
        norm_a = math.sqrt(sum(v * v for v in vec_a.values())) or 1.0
        norm_b = math.sqrt(sum(v * v for v in vec_b.values())) or 1.0
        return dot / (norm_a * norm_b)

    def add_documents(self, documents: list[str], metadata: list[dict] | None = None) -> None:
        """添加文档到向量库。"""
        all_tokens = [self._tokenize(doc) for doc in documents]
        self._compute_idf(all_tokens)
        for i, (doc, tokens) in enumerate(zip(documents, all_tokens)):
            self.chunks.append(
                {
                    "content": doc,
                    "embedding": self._embed(tokens),
                    "metadata": metadata[i] if metadata else {},
                }
            )

    def query(self, text: str, top_k: int = 3) -> list[dict]:
        """检索 top_k 相关文档。"""
        query_tokens = self._tokenize(text)
        query_vec = self._embed(query_tokens)
        scored = []
        for chunk in self.chunks:
            score = self._cosine(query_vec, chunk["embedding"])
            scored.append((score, chunk))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [chunk for score, chunk in scored[:top_k] if score > 0]

    def clear(self) -> None:
        self.chunks = []
        self.vocab = {}
        self.idf = {}


def chunk_text(text: str, max_chunk_size: int = 200) -> list[str]:
    """将长文本切分为块。"""
    if len(text) <= max_chunk_size:
        return [text]
    chunks = []
    # 按段落切分
    paragraphs = text.split("\n\n")
    current = ""
    for para in paragraphs:
        if len(current) + len(para) <= max_chunk_size:
            current += para + "\n\n"
        else:
            if current:
                chunks.append(current.strip())
            # 段落过长则按句子切分
            if len(para) > max_chunk_size:
                sentences = re.split(r"([。！？.!?])", para)
                sentence_buf = ""
                for s in sentences:
                    if len(sentence_buf) + len(s) <= max_chunk_size:
                        sentence_buf += s
                    else:
                        if sentence_buf:
                            chunks.append(sentence_buf.strip())
                        sentence_buf = s
                if sentence_buf:
                    chunks.append(sentence_buf.strip())
                current = ""
            else:
                current = para + "\n\n"
    if current:
        chunks.append(current.strip())
    return chunks
