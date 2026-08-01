"""流式 chunk 文本提取的单元测试。"""

from types import SimpleNamespace

from app.arena.stream_utils import extract_chunk_parts, extract_chunk_text


def test_none_chunk_returns_empty():
    assert extract_chunk_text(None) == ""
    assert extract_chunk_parts(None) == ("", "")


def test_string_content():
    chunk = SimpleNamespace(content="你好")
    assert extract_chunk_text(chunk) == "你好"
    assert extract_chunk_parts(chunk) == ("", "你好")


def test_list_of_text_dict_blocks():
    chunk = SimpleNamespace(
        content=[
            {"type": "text", "text": "现在"},
            {"type": "text", "text": "是"},
            {"type": "thinking", "thinking": "思考中"},
        ]
    )
    # 兼容接口仍合并；parts 分离
    assert extract_chunk_text(chunk) == "思考中现在是"
    assert extract_chunk_parts(chunk) == ("思考中", "现在是")


def test_parts_ignore_tool_use_blocks():
    chunk = SimpleNamespace(
        content=[
            {"type": "thinking", "thinking": "先调工具"},
            {"type": "tool_use", "name": "get_current_time", "id": "1"},
            {"type": "text", "text": "答案"},
        ]
    )
    thinking, text = extract_chunk_parts(chunk)
    assert thinking == "先调工具"
    assert text == "答案"


def test_list_of_object_blocks_with_text_attr():
    chunk = SimpleNamespace(content=[SimpleNamespace(text="foo"), SimpleNamespace(text="bar")])
    assert extract_chunk_text(chunk) == "foobar"


def test_empty_content():
    chunk = SimpleNamespace(content="")
    assert extract_chunk_text(chunk) == ""
