"""WebmonHandlers class.

SocketIO handlers for webmon.
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
    """Generic handlers right now, but will be per-page soon?"""

    def __init__(self, bridge: NapariBridge, namespace: str):
        super().__init__(namespace)
        self.bridge = bridge
        self.lock = Lock()
        self.thread = None

    def on_connection_test(self, message):
        LOGGER.info("connection_test: %s", message)
        session['receive_count'] = session.get('receive_count', 0) + 1
        emit(
            'connection_response',
            {'data': message['data'], 'count': session['receive_count']},
        )

    def on_input_data_request(self, message):
        session['receive_count'] = session.get('receive_count', 0) + 1
        data = {'client': "webmon", 'pid': os.getpid()}
        emit('input_data_response', json.dumps(data))

    def on_gui_input(self, message):
        self.bridge.send_command(message)

    def on_connect(self):
        LOGGER.info("on_connect")
        global thread

        # Lock is so that we only create one background task that
        # is shared among for all viewers.
        with self.lock:
            if self.thread is None:
                LOGGER.info("Webmon: Creating background task...")
                self.thread = self.bridge.start_background_task()
