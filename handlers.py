"""WebmonHandlers class.

SocketIO handlers for webmon. There's only one handlers class right now,
but soon we will have one per page?
"""
import json
import logging
import os
from threading import Lock

from flask import session
from flask_socketio import Namespace, emit

from bridge import NapariBridge

LOGGER = logging.getLogger("webmon")


class WebmonHandlers(Namespace):
    """SocketIO handlers for webmon.

    Parameters
    ----------
    bridge : NapariBridge
        This communicates with napari through the NapariClient.
    namespace : str
        The SocketIO namespace such as "/test".

    Attributes
    ----------
    lock : Lock
        Lock used for thread creation.
    thread : Thread
        The Thread-compatible object returned from
        socketio.start_background_task().
    """

    def __init__(self, bridge: NapariBridge, namespace: str):
        super().__init__(namespace)
        self.bridge = bridge
        self.lock = Lock()
        self.thread = None

    def on_connection_test(self, message):
        """The webapp emits this when a new connection is created."""
        LOGGER.info("connection_test: %s", message)
        session['receive_count'] = session.get('receive_count', 0) + 1
        emit(
            'connection_response',
            {'data': message['data'], 'count': session['receive_count']},
        )

    def on_input_data_request(self, message):
        """The webapp also emits this when a new connection is created."""
        session['receive_count'] = session.get('receive_count', 0) + 1
        data = {'client': "webmon", 'pid': os.getpid()}
        emit('input_data_response', json.dumps(data))

    def on_send_command(self, message):
        """Web app emits this to send a command."""
        LOGGER.info("on_second_command")
        self.bridge.send_command(message)

    def on_connect(self):
        """Create a background thread on connection.."""
        LOGGER.info("on_connect")

        # Lock is so that we only create one background task that
        # is shared among for all viewers.
        with self.lock:
            if self.thread is None:
                LOGGER.info("Webmon: Creating background task...")
                self.thread = self.bridge.start_background_task()
