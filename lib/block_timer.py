"""block_timer utility
"""
from typing import Optional
import time
import contextlib
from perf_event import PerfEvent


@contextlib.contextmanager
def block_timer(
    name: str, category: Optional[str] = None, **kwargs,
):
    """Time a block of code.

    block_timer can be used when perfmon is disabled. Use perf_timer instead
    if you want your timer to do nothing when perfmon is disabled.

    Notes
    -----
    Most of the time you should use the perfmon config file to monkey-patch
    perf_timer's into methods and functions. Then you do not need to use
    block_timer or perf_timer context objects explicitly at all.

    Parameters
    ----------
    name : str
        The name of this timer.
    category : str
        Comma separated categories such has "render,update".
    print_time : bool
        Print the duration of the timer when it finishes.
    **kwargs : dict
        Additional keyword arguments for the "args" field of the event.

    Example
    -------
    with block_timer("draw") as event:
        draw_stuff()
    print(f"The timer took {event.duration_ms} milliseconds.")
    """
    start_ns = time.perf_counter_ns()

    # Pass in start_ns for start and end, we call update_end_ns
    # once the block as finished.
    event = PerfEvent(name, start_ns, start_ns, category, **kwargs)
    yield event

    # Update with the real end time.
    event.update_end_ns(time.perf_counter_ns())

    print(f"{name} {event.duration_ms:.3f}ms")
