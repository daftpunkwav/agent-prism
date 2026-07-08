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
            self.chunks.append({
                "content": doc,
                "embedding": self._embed(tokens),
                "metadata": metadata[i] if metadata else {},
            })

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


class ContextRetriever:
    """检索增强上下文管理器：组合滑动窗口 + 摘要 + 向量检索。"""

    def __init__(self, strategy: str = "hybrid"):
        self.strategy = strategy
        self.vector_store = SimpleVectorStore()
        self._window: list[dict] = []
        self._summary: str = ""
        self._window_size = 6

    def add(self, role: str, content: str) -> None:
        self._window.append({"role": role, "content": content})
        # 索引到向量库
        chunks = chunk_text(content)
        for chunk in chunks:
            self.vector_store.add_documents(
                [chunk],
                [{"role": role, "index": len(self._window) - 1}]
            )
        # 保持窗口大小
        if len(self._window) > self._window_size * 2:
            overflow = self._window[: -self._window_size]
            self._window = self._window[-self._window_size:]
            # 更新摘要
            if not self._summary:
                self._summary = self._build_summary(overflow)
            else:
                self._summary += "\n" + self._build_summary(overflow)

    def _build_summary(self, messages: list[dict]) -> str:
        lines = []
        for msg in messages:
            role = msg["role"]
            content = msg["content"][:80]
            if role == "user":
                lines.append(f"用户问: {content}")
            elif role == "assistant":
                lines.append(f"助手答: {content}")
        return "\n".join(lines)

    def get_context(self, current_query: str | None = None) -> list[dict]:
        """获取当前策略下的上下文。"""
        if self.strategy == "sliding":
            return self._window[-self._window_size:]

        if self.strategy == "summary":
            result = []
            if self._summary:
                result.append({"role": "system", "content": f"[上下文摘要]\n{self._summary}"})
            result.extend(self._window[-self._window_size:])
            return result

        if self.strategy == "vector":
            # 向量检索 top-3 相关历史
            if current_query:
                relevant = self.vector_store.query(current_query, top_k=3)
            else:
                relevant = [c for c in self.vector_store.chunks[-3:]]
            result = []
            if relevant:
                result.append({"role": "system", "content": "[相关历史]\n" + "\n".join(c["content"][:100] for c in relevant)})
            return result

        if self.strategy == "hybrid":
            # 混合策略：滑动窗口 + 向量检索 top-k + 摘要
            result = []
            if self._summary:
                result.append({"role": "system", "content": f"[早期摘要]\n{self._summary[:300]}"})
            if current_query:
                relevant = self.vector_store.query(current_query, top_k=2)
                if relevant:
                    result.append({"role": "system", "content": "[相关历史]\n" + "\n".join(c["content"][:80] for c in relevant)})
            result.extend(self._window[-self._window_size:])
            return result

        return self._window[-self._window_size:]

    def reset(self) -> None:
        self._window = []
        self._summary = ""
        self.vector_store.clear()