"""테스트 베드 기록장 — 한 파일에 시각 순서대로 한 줄씩 덧붙인다.

시각 = UTC + 설정의 한국 시각 차이(kst_offset_hours). PC 지역 시각을 쓰지 않는다.
비밀 낱말(설정 secret_words)이 이름에 든 값은 가리고, 긴 값은 앞부분만 남긴다.
기록장을 못 쓰면 삼키지 않고 오류를 그대로 올린다.
"""
import datetime
import os
import threading

MASK = "(가림)"
CUT_MARK = "…"
SEP = " | "


class Log:
    def __init__(self, path, offset_hours, time_format, max_value_chars, secret_words):
        self.path = path
        self.offset = datetime.timedelta(hours=offset_hours)
        self.time_format = time_format
        self.max_chars = max_value_chars
        self.secret_words = [w.lower() for w in secret_words]
        self._lock = threading.Lock()
        folder = os.path.dirname(path)
        if folder:
            os.makedirs(folder, exist_ok=True)

    def now_text(self):
        return (datetime.datetime.now(datetime.timezone.utc) + self.offset).strftime(self.time_format)

    def _value(self, name, value):
        if any(w in name.lower() for w in self.secret_words):
            return MASK
        text = str(value).replace("\r", " ").replace("\n", " ")
        if len(text) > self.max_chars:
            text = text[:self.max_chars] + CUT_MARK
        return text

    def write(self, where, event, **params):
        parts = [self.now_text(), where, event]
        parts.extend(k + "=" + self._value(k, v) for k, v in params.items())
        with self._lock:
            with open(self.path, "a", encoding="utf-8", newline="\n") as f:
                f.write(SEP.join(parts) + "\n")


def from_config(cfg, resolve):
    """설정에서 기록장을 하나 만든다. resolve(상대 경로) → 절대 경로."""
    c = cfg["log"]
    return Log(os.path.join(resolve(c["dir"]), c["file"]), cfg["kst_offset_hours"],
               c["time_format"], c["max_value_chars"], c["secret_words"])
