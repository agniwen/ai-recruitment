from interview_clock import (
    InterviewTimelinePhase,
    PausableInterviewClock,
    classify_timeline_phase,
)


class ManualNow:
    def __init__(self, value: float = 0.0) -> None:
        self.value = value

    def __call__(self) -> float:
        return self.value


def test_reconnect_pause_does_not_consume_interview_active_time():
    now = ManualNow(100.0)
    clock = PausableInterviewClock(now=now, reconnect_pause_limit=300.0)

    now.value = 130.0
    clock.pause_for_reconnect()
    now.value = 250.0

    assert clock.elapsed() == 30.0

    clock.resume_from_reconnect()
    now.value = 280.0

    assert clock.elapsed() == 60.0
    assert clock.reconnect_pause_used == 120.0
    assert clock.reconnect_pause_remaining == 180.0


def test_reconnect_pause_cap_is_cumulative():
    now = ManualNow()
    clock = PausableInterviewClock(now=now, reconnect_pause_limit=300.0)

    clock.pause_for_reconnect()
    now.value = 180.0
    clock.resume_from_reconnect()
    clock.pause_for_reconnect()
    now.value = 300.0
    clock.resume_from_reconnect()

    assert clock.reconnect_pause_remaining == 0.0
    assert clock.can_start_reconnect_pause is False


def test_timeline_uses_the_confirmed_active_time_boundaries():
    # 23:55:00 stop new questions, 23:58:00 finish current,
    # 24:00:00 close, 24:01:00 kill.
    assert classify_timeline_phase(35 * 60) is InterviewTimelinePhase.QUESTIONS
    assert classify_timeline_phase(86_099.9) is InterviewTimelinePhase.QUESTIONS
    assert classify_timeline_phase(86_100.0) is InterviewTimelinePhase.FINISH_CURRENT
    assert classify_timeline_phase(86_279.9) is InterviewTimelinePhase.FINISH_CURRENT
    assert classify_timeline_phase(86_280.0) is InterviewTimelinePhase.WRAP_UP
    assert classify_timeline_phase(86_399.9) is InterviewTimelinePhase.WRAP_UP
    assert classify_timeline_phase(86_400.0) is InterviewTimelinePhase.CLOSE
    assert classify_timeline_phase(86_459.9) is InterviewTimelinePhase.CLOSE
    assert classify_timeline_phase(86_460.0) is InterviewTimelinePhase.KILL
