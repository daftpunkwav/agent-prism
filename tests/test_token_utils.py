"""Token 统计与估算的单元测试。"""

from types import SimpleNamespace

from app.arena.token_utils import TokenTracker, estimate_tokens, extract_usage


def test_estimate_tokens_empty_and_nonempty():
    assert estimate_tokens("") == 0
    # 粗略估算：len//3，但至少 1
    assert estimate_tokens("ab") == 1
    assert estimate_tokens("a" * 30) == 10


def test_tracker_uses_estimate_before_api_usage():
    t = TokenTracker(context_window=1000, max_input_tokens=800, max_output_tokens=200)
    t.seed_prompt("a" * 30, "b" * 30)  # 估算 10 + 10 = 20
    assert t.effective_input_tokens == 20
    assert t.output_tokens == 0
    assert t.total_tokens == 20


def test_tracker_switches_to_api_usage_after_add():
    t = TokenTracker(context_window=1000, max_input_tokens=800, max_output_tokens=200)
    t.seed_prompt("a" * 30, "b" * 30)
    t.add_usage({"input_tokens": 100, "output_tokens": 40})
    # 一旦有 API 真实用量，effective_input 改用真实值而非估算
    assert t.effective_input_tokens == 100
    assert t.output_tokens == 40
    assert t.total_tokens == 140


def test_tracker_percentages_and_capping():
    t = TokenTracker(context_window=1000, max_input_tokens=800, max_output_tokens=200)
    t.add_usage({"input_tokens": 400, "output_tokens": 100})
    # context: 500/1000 = 50%
    assert t.context_usage_pct == 50.0
    # input: 400/800 = 50%
    assert t.input_usage_pct == 50.0

    # 超出上限时封顶 100%
    t2 = TokenTracker(context_window=100, max_input_tokens=100, max_output_tokens=50)
    t2.add_usage({"input_tokens": 999, "output_tokens": 999})
    assert t2.context_usage_pct == 100.0
    assert t2.input_usage_pct == 100.0


def test_tracker_zero_limits_no_division_error():
    t = TokenTracker(context_window=0, max_input_tokens=0, max_output_tokens=0)
    t.add_usage({"input_tokens": 10, "output_tokens": 5})
    assert t.context_usage_pct == 0.0
    assert t.input_usage_pct == 0.0


def test_tracker_as_dict_shape():
    t = TokenTracker(context_window=1000, max_input_tokens=800, max_output_tokens=200)
    t.add_usage({"input_tokens": 100, "output_tokens": 40})
    d = t.as_dict()
    assert d["input_tokens"] == 100
    assert d["output_tokens"] == 40
    assert d["total_tokens"] == 140
    assert set(d) == {
        "input_tokens",
        "output_tokens",
        "total_tokens",
        "context_window",
        "max_input_tokens",
        "max_output_tokens",
        "context_usage_pct",
        "input_usage_pct",
    }


def test_extract_usage_from_usage_metadata():
    output = SimpleNamespace(usage_metadata={"input_tokens": 12, "output_tokens": 7})
    assert extract_usage({"output": output}) == {"input_tokens": 12, "output_tokens": 7}


def test_extract_usage_from_response_metadata_openai_style():
    output = SimpleNamespace(
        usage_metadata=None,
        response_metadata={"token_usage": {"prompt_tokens": 30, "completion_tokens": 9}},
    )
    assert extract_usage({"output": output}) == {"input_tokens": 30, "output_tokens": 9}


def test_extract_usage_missing_output():
    assert extract_usage({}) == {"input_tokens": 0, "output_tokens": 0}
