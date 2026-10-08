"""AG-UI adapter without model or application initialization side effects."""

from ag_ui.core import EventType
from copilotkit import LangGraphAGUIAgent


class MultiInterruptAGUIAgent(LangGraphAGUIAgent):
    """Keep subagent text out of chat while preserving task and UI events."""

    _TEXT_EVENTS = frozenset({
        EventType.TEXT_MESSAGE_START,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_END,
        EventType.TEXT_MESSAGE_CHUNK,
        EventType.REASONING_START,
        EventType.REASONING_MESSAGE_START,
        EventType.REASONING_MESSAGE_CONTENT,
        EventType.REASONING_MESSAGE_END,
        EventType.REASONING_MESSAGE_CHUNK,
        EventType.REASONING_END,
        EventType.REASONING_ENCRYPTED_VALUE,
    })

    def __init__(
        self,
        *,
        name,
        graph,
        description=None,
        config=None,
        enable_legacy_on_interrupt_event=False,
        emit_interrupt_outcome=True,
    ):
        super().__init__(name=name, graph=graph, description=description, config=config)
        self.enable_legacy_on_interrupt_event = enable_legacy_on_interrupt_event
        self.emit_interrupt_outcome = emit_interrupt_outcome

    def _dispatch_event(self, event):
        active_run = getattr(self, "active_run", None)
        if active_run is not None:
            if (
                event.type == EventType.CUSTOM
                and event.name == "copilotkit_manually_emit_message"
                and active_run.get("current_subagent_run_id")
            ):
                return None
            # Reuse AG-UI's message-id pairing so a child message's closing
            # event stays hidden even after the subagent window has ended.
            if event.type in self._TEXT_EVENTS and self._hidden_should_suppress(active_run, event):
                return None
        return super()._dispatch_event(event)

