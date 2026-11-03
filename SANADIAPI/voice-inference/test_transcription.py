"""Exercise the real request/recognition functions without loading GPU models."""
import ast
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from threading import Semaphore
from types import SimpleNamespace
from unittest.mock import Mock


class HttpError(Exception):
    def __init__(self, status_code, detail):
        self.status_code = status_code
        super().__init__(detail)


class Recording:
    filename = "question.wav"

    def __init__(self):
        self.audio = BytesIO(b"test audio")

    async def read(self, size):
        return self.audio.read(size)


class TranscriptionTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        source = Path(__file__).with_name("service.py")
        tree = ast.parse(source.read_text(encoding="utf-8-sig"))
        functions = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                     and node.name in {"transcribe", "transcribe_file"}]
        for node in functions:
            node.decorator_list = []
        self.recognizer = Mock()

        async def threadpool(function, *args):
            return function(*args)

        scope = dict(File=lambda default: default, Form=lambda default: default,
                     Header=lambda default: default, UploadFile=Recording, authorize=Mock(),
                     HTTPException=HttpError, Path=Path, tempfile=tempfile,
                     run_in_threadpool=threadpool, inference_slots=Semaphore(1), asr=self.recognizer)
        exec(compile(ast.Module(body=functions, type_ignores=[]), str(source), "exec"), scope)
        self.transcribe = scope["transcribe"]

    async def test_language_reaches_recognizer_and_text_is_not_translated(self):
        for language, text in [("ar", "معدلي 3.75"), ("en", "My GPA is 3.75"), (None, "Original text"), ("auto", "Original text")]:
            with self.subTest(language=language):
                self.recognizer.transcribe.return_value = ([SimpleNamespace(text=text)], SimpleNamespace(language=language))
                result = await self.transcribe(file=Recording(), language=language)
                args, options = self.recognizer.transcribe.call_args
                self.assertEqual(None if language == "auto" else language, options["language"])
                self.assertEqual("transcribe", options["task"])
                self.assertEqual(text, result["text"])
                self.assertFalse(Path(args[0]).exists())

    async def test_invalid_language_never_runs_recognition(self):
        with self.assertRaises(HttpError) as error:
            await self.transcribe(file=Recording(), language="invalid")
        self.assertEqual(400, error.exception.status_code)
        self.recognizer.transcribe.assert_not_called()


if __name__ == "__main__":
    unittest.main()
