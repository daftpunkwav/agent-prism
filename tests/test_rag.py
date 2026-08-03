"""RAG 向量检索的单元测试。"""

from app.arena.rag import SimpleVectorStore, chunk_text


def test_chunk_text_short():
    """短文本不分块"""
    chunks = chunk_text("hello world")
    assert chunks == ["hello world"]


def test_chunk_text_long():
    """长文本按段落分块"""
    text = "段落一内容。\n\n段落二内容。\n\n段落三内容。"
    chunks = chunk_text(text, max_chunk_size=10)
    assert len(chunks) >= 1


def test_simple_vector_store_add_and_query():
    vs = SimpleVectorStore()
    vs.add_documents(["苹果是水果", "香蕉是水果", "汽车是交通工具"])
    results = vs.query("苹果")
    assert len(results) > 0
    assert "苹果" in results[0]["content"]


def test_simple_vector_store_relevance():
    vs = SimpleVectorStore()
    vs.add_documents(
        [
            "Python 是编程语言",
            "Java 是编程语言",
            "猫是宠物",
        ]
    )
    results = vs.query("Python 编程")
    assert len(results) > 0
    assert "Python" in results[0]["content"]


def test_simple_vector_store_clear():
    vs = SimpleVectorStore()
    vs.add_documents(["test"])
    vs.clear()
    results = vs.query("test")
    assert len(results) == 0
