"""流式 chunk 文本提取的单元测试。"""

from types import SimpleNamespace

from app.arena.stream_utils import extract_chunk_text


def test_none_chunk_returns_empty():
    assert extract_chunk_text(None) == ""


def test_string_content():
    chunk = SimpleNamespace(content="你好")
    assert extract_chunk_text(chunk) == "你好"


def test_list_of_text_dict_blocks():
    chunk = SimpleNamespace(
        content=[
            {"type": "text", "text": "现在"},
            {"type": "text", "text": "是"},
            {"type": "thinking", "text": "忽略"},  # 非 text 块被跳过
        ]
    )
    assert extract_chunk_text(chunk) == "现在是"


def test_list_of_object_blocks_with_text_attr():
    chunk = SimpleNamespace(
        content=[SimpleNamespace(text="foo"), SimpleNamespace(text="bar")]
    )
    assert extract_chunk_text(chunk) == "foobar"


def test_empty_content():
    chunk = SimpleNamespace(content="")
    assert extract_chunk_text(chunk) == ""
