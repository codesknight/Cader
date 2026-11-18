"""Actual Deep Agents graph with an injected deterministic chat model.

This checks framework wiring and error observations, not LLM competence or CAD geometry.
"""

import sys

import anyio
from deepagents import create_deep_agent
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.tools import StructuredTool, ToolException
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.errors import GraphRecursionError

from cader.config import ServerConfig
from cader.mcp_client import connect


class ScriptedModel(BaseChatModel):
    model_calls: int = 0
    repeat: bool = False

    @property
    def _llm_type(self) -> str:
        return "cader-deterministic-smoke"

    def bind_tools(self, tools, *, tool_choice=None, **kwargs):
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        self.model_calls += 1
        observations = [
            message
            for message in messages
            if isinstance(message, ToolMessage) and message.name == "general_probe"
        ]
        if self.repeat or len(observations) < 2:
            message = AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "general_probe",
                        "args": {"fail": len(observations) == 0},
                        "id": f"probe-{self.model_calls}",
                        "type": "tool_call",
                    }
                ],
            )
        else:
            message = AIMessage(content="Deterministic protocol fixture completed.")
        return ChatResult(generations=[ChatGeneration(message=message)])


async def run_spike() -> dict:
    config = ServerConfig(
        transport="stdio",
        command=sys.executable,
        args=["-m", "cader.smoke_server"],
        timeout_seconds=90,
    )
    async with connect(config) as session:
        return await _run_connected_spike(session)


async def _run_connected_spike(session) -> dict:
    calls = []

    async def general_probe(fail: bool) -> str:
        """Probe a fixture; fail=True intentionally exercises tool error feedback."""
        calls.append(fail)
        result = await session.call_tool(
            "general_fail" if fail else "general_ping",
            {} if fail else {"value": "fixture-pong"},
        )
        if result.isError:
            raise ToolException("intentional MCP fixture error")
        return "".join(item.text for item in result.content if item.type == "text")

    probe_tool = StructuredTool.from_function(coroutine=general_probe, handle_tool_error=True)
    model = ScriptedModel()
    graph = create_deep_agent(
        model=model,
        tools=[probe_tool],
        checkpointer=InMemorySaver(),
        system_prompt="Run the deterministic fixture probe. No filesystem or CAD work.",
    )
    config = {"configurable": {"thread_id": "cader-spike"}, "recursion_limit": 12}
    events = []
    with anyio.fail_after(30):
        async for update in graph.astream(
            {"messages": [{"role": "user", "content": "Probe the fixture."}]},
            config=config,
            stream_mode="updates",
        ):
            events.extend(update)
        state = await graph.aget_state(config)
    observations = [
        message for message in state.values["messages"] if isinstance(message, ToolMessage)
    ]
    # A separate deliberately nonterminating model verifies the graph step budget.
    bounded = create_deep_agent(model=ScriptedModel(repeat=True), tools=[probe_tool])
    terminated = False
    with anyio.fail_after(30):
        try:
            await bounded.ainvoke(
                {"messages": [{"role": "user", "content": "Repeat fixture probe."}]},
                config={"recursion_limit": 4},
            )
        except GraphRecursionError:
            terminated = True
    checks = {
        "tool_error_observed": any(message.status == "error" for message in observations),
        "successful_tool_observed": any(
            message.status == "success" and "fixture-pong" in str(message.content)
            for message in observations
        ),
        "ordered_retry": calls[:2] == [True, False],
        "checkpoint_readback": bool(state.values.get("messages")),
        "event_stream": bool(events),
        "step_budget_terminates": terminated,
    }
    return {
        "ok": all(checks.values()),
        "kind": "deterministic-harness-fixture",
        "framework": "deepagents",
        "model": model._llm_type,
        "transport": "mcp-stdio",
        "model_calls": model.model_calls,
        "primary_tool_calls": len(observations),
        "event_nodes": sorted(set(events)),
        "checks": checks,
        "real_model_evaluated": False,
        "cad_evaluated": False,
    }
