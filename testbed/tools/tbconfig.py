"""테스트 베드 설정 읽기 — 설정 파일 경로는 명령 줄에서 받는다(코드에 경로를 두지 않는다).

설정 안의 경로는 모두 설정 파일이 있는 폴더를 기준으로 한 상대 경로다.
읽은 설정은 같은 폴더의 설정 꼴(config_schema)로 검사하고, 틀리면 ConfigError 를 던진다.
"""
import json
import os

import schemacheck


class ConfigError(Exception):
    pass


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


class Config:
    def __init__(self, path):
        self.path = os.path.abspath(path)
        self.folder = os.path.dirname(self.path)
        try:
            self.data = read_json(self.path)
        except (OSError, ValueError) as e:
            raise ConfigError("설정을 읽지 못함: " + self.path + " — " + str(e))
        if not isinstance(self.data, dict) or "config_schema" not in self.data:
            raise ConfigError("설정에 config_schema 칸이 없음: " + self.path)
        schema_path = self.resolve(self.data["config_schema"])
        try:
            schema = read_json(schema_path)
        except (OSError, ValueError) as e:
            raise ConfigError("설정 꼴을 읽지 못함: " + schema_path + " — " + str(e))
        errors = schemacheck.validate(self.data, schema)
        geo = self.data.get("geo", {})
        if not errors and (geo["lat_min"] >= geo["lat_max"] or geo["lng_min"] >= geo["lng_max"]):
            errors.append("$.geo: 최소가 최대보다 작아야 함")
        if errors:
            raise ConfigError("설정이 꼴에 맞지 않음(" + self.path + "):\n  " + "\n  ".join(errors))

    def resolve(self, rel):
        return os.path.normpath(os.path.join(self.folder, rel))

    def __getitem__(self, key):
        return self.data[key]
