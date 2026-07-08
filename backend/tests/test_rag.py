"""RAG 向量检索的单元测试。"""


from app.arena.rag import ContextRetriever, SimpleVectorStore, chunk_text


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
    vs.add_documents([
        "Python 是编程语言",
        "Java 是编程语言",
        "猫是宠物",
    ])
    results = vs.query("Python 编程")
    assert len(results) > 0
    assert "Python" in results[0]["content"]


def test_simple_vector_store_clear():
    vs = SimpleVectorStore()
    vs.add_documents(["test"])
    vs.clear()
    results = vs.query("test")
    assert len(results) == 0


def test_context_retriever_sliding():
    cr = ContextRetriever(strategy="sliding")
    cr.add("user", "你好")
    cr.add("assistant", "你好，有什么可以帮你的？")
    cr.add("user", "今天天气怎么样？")
    context = cr.get_context()
    assert len(context) >= 1


def test_context_retriever_summary_strategy():
    cr = ContextRetriever(strategy="summary")
    for i in range(10):
        cr.add("user", f"问题 {i}")
        cr.add("assistant", f"回答 {i}")
    context = cr.get_context()
    # 摘要策略：超过窗口会生成摘要
    assert any("摘要" in c.get("content", "") for c in context)


def test_context_retriever_vector_strategy():
    cr = ContextRetriever(strategy="vector")
    cr.add("user", "Python 是什么？")
    cr.add("assistant", "Python 是编程语言")
    cr.add("user", "Java 呢？")
    cr.add("assistant", "Java 也是编程语言")
    cr.add("user", "猫呢？")
    cr.add("assistant", "猫是动物")
    context = cr.get_context(current_query="Python")
    # 向量策略：返回相关历史
    assert len(context) >= 1


def test_context_retriever_hybrid_strategy():
    cr = ContextRetriever(strategy="hybrid")
    for i in range(15):
        cr.add("user", f"问题 {i}: Python 怎么样")
        cr.add("assistant", f"回答 {i}: Python 很好用")
    context = cr.get_context(current_query="Python")
    # 混合策略：摘要 + 向量 + 滑动窗口
    assert len(context) >= 1


def test_context_retriever_reset():
    cr = ContextRetriever(strategy="sliding")
    cr.add("user", "test")
    cr.reset()
    context = cr.get_context()
    assert len(context) == 0