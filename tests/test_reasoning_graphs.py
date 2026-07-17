"""推理模式图构建器的单元测试。"""

from app.arena.reasoning_graph import (
    build_cot_tool_graph,
    build_react_graph,
    build_reasoning_graph,
    build_reflexion_graph,
    build_tot_graph,
    get_reasoning_graph,
)


def test_react_graph_has_correct_nodes():
    graph = build_react_graph()
    nodes = list(graph.nodes.keys())
    assert "agent" in nodes
    assert "tools" in nodes


def test_cot_tool_graph_has_correct_nodes():
    graph = build_cot_tool_graph()
    nodes = list(graph.nodes.keys())
    assert "think" in nodes
    assert "act" in nodes
    assert "tools" in nodes


def test_tot_graph_has_correct_nodes():
    graph = build_tot_graph()
    nodes = list(graph.nodes.keys())
    assert "generate" in nodes
    assert "evaluate" in nodes
    assert "execute" in nodes
    assert "tools" in nodes


def test_reflexion_graph_has_correct_nodes():
    graph = build_reflexion_graph()
    nodes = list(graph.nodes.keys())
    assert "execute" in nodes
    assert "reflect" in nodes


def test_all_modes_build_successfully():
    for mode in ("react", "cot_tool", "tot", "reflexion"):
        graph = build_reasoning_graph(mode)
        assert graph is not None


def test_get_reasoning_graph_returns_compiled():
    """验证所有模式都能编译出图"""
    for mode in ("react", "cot_tool", "tot", "reflexion"):
        compiled = get_reasoning_graph(mode)
        assert compiled is not None
