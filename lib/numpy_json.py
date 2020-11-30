"""NumpyJSON class.
"""
import json

import numpy as np


class NumpyJSONEncoder(json.JSONEncoder):
    """A JSONEncoder that also converts ndarray's to lists.

    We might want to also derive from flask.jsonJSONEncoder which supports
    "datetime, UUID, dataclasses and Markup objects"?
    """

    def default(self, o):
        if isinstance(o, np.ndarray):
            return o.tolist()
        return json.JSONEncoder.default(self, o)


class NumpyJSON:
    """So socketio can encode numpy arrays for us.

    SocketIO wants an object with dumps() and loads() methods.
    """

    @staticmethod
    def dumps(obj, *args, **kwargs):
        kwargs.update({"cls": NumpyJSONEncoder})
        return json.dumps(obj, *args, **kwargs)

    @staticmethod
    def loads(obj, *args, **kwargs):
        return json.loads(obj, *args, **kwargs)
