"""실자료 설정(config/realline.json) 읽기 — 경로는 이 설정 파일 폴더 기준, 작업 폴더는 work.env 에서만.

work.env 의 한 줄 '<열쇠>=<값>' 을 읽어 설정 안 글의 표시(work_env_mark)를 그 값으로 바꾼다.
환경변수에 같은 열쇠가 있으면 그것이 먼저다(work.env 규칙 그대로). 테스트 베드 기본 설정(testbed_config)도 함께 연다.
"""
import os

import tbconfig

ENV_SEP = "="
COMMENT_MARK = "#"


class RealError(Exception):
    pass


def read_work_env(path, key):
    if os.environ.get(key):
        return os.environ[key]
    try:
        with open(path, encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith(COMMENT_MARK) or ENV_SEP not in line:
                    continue
                k, v = line.split(ENV_SEP, 1)
                if k.strip() == key:
                    return v.strip()
    except OSError as e:
        raise RealError("work.env 를 읽지 못함: " + path + " — " + str(e))
    raise RealError("work.env 에 " + key + " 이(가) 없음: " + path)


class RealConfig:
    def __init__(self, path):
        self.path = os.path.abspath(path)
        self.folder = os.path.dirname(self.path)
        try:
            self.data = tbconfig.read_json(self.path)
        except (OSError, ValueError) as e:
            raise RealError("실자료 설정을 읽지 못함: " + self.path + " — " + str(e))
        d = self.data
        self.root = read_work_env(self.resolve(d["work_env"]), d["work_env_key"])
        try:
            self.tb = tbconfig.Config(self.resolve(d["testbed_config"]))
        except tbconfig.ConfigError as e:
            raise RealError(str(e))

    def resolve(self, rel):
        return os.path.normpath(os.path.join(self.folder, rel))

    def work_path(self, text):
        """설정 글의 작업 폴더 표시를 work.env 값으로 바꾼 절대 경로."""
        return os.path.normpath(text.replace(self.data["work_env_mark"], self.root))

    def line_path(self, name):
        sc = self.tb["scenes"]
        return os.path.join(self.tb.resolve(sc["lines_dir"]), name + sc["line_suffix"])

    def scene_path(self, name):
        sc = self.tb["scenes"]
        return os.path.join(self.tb.resolve(sc["dir"]), name + sc["line_suffix"])

    def __getitem__(self, key):
        return self.data[key]
