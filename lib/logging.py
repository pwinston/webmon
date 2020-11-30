"""Logging.

Very strawman right now, just to get started.
"""

import logging
from pathlib import Path

LOGGER = logging.getLogger("webmon")

# If true we delete the previous log file on startup. There are pros and
# cons to deleting it depending on how you are monitoring it.
DELETE_LOG_FILE = False

FORMAT = "%(levelname)s - %(name)s - %(message)s"


def _log_to_file(path: str) -> None:
    """Log "webmon" messages to the given file.

    Parameters
    ----------
    path : str
        Log to this file path.
    """
    if DELETE_LOG_FILE:
        try:
            Path(path).unlink()
        except FileNotFoundError:
            pass  # It didn't exist.

    fh = logging.FileHandler(path)

    formatter = logging.Formatter(FORMAT)
    fh.setFormatter(formatter)
    LOGGER.addHandler(fh)

    LOGGER.setLevel(logging.DEBUG)
    LOGGER.info("Writing log to %s", path)


def _log_to_console() -> None:
    """Log to console."""
    logging.basicConfig(level=logging.DEBUG, format=FORMAT)
    LOGGER.info("Logging to console.")


def setup_logging(log_path: str) -> None:
    """Setup logging to file or console.

    Parameters
    ----------
    log_path : str
        The path the write the log file.
    """
    if log_path is not None:
        _log_to_file(log_path)
    else:
        _log_to_console()
