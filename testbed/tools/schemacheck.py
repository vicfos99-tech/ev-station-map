"""JSON Schema 의 일부만 쓰는 작은 꼴 검사기(파이썬 기본 모듈만).

쓰는 낱말: type, const, enum, required, properties, additionalProperties(참거짓 또는 꼴),
minProperties, items, minItems, maxItems, minLength, minimum, maximum, exclusiveMinimum,
oneOf, $ref(같은 파일 안 '#/...' 만).
결과는 '어디(경로): 무엇이 틀림' 글의 목록이다. 비면 통과. 오류를 삼키지 않는다 —
모르는 $ref 는 그 자리 오류로 낸다.
"""

TYPE_CHECKS = {
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "string": lambda v: isinstance(v, str),
    "boolean": lambda v: isinstance(v, bool),
    "null": lambda v: v is None,
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
}

REF_HEAD = "#"
REF_SEP = "/"


def _is_number(v):
    return TYPE_CHECKS["number"](v)


def _resolve(root, ref):
    if not ref.startswith(REF_HEAD):
        raise ValueError("같은 파일 안의 $ref 만 쓴다: " + ref)
    node = root
    for part in ref[len(REF_HEAD):].split(REF_SEP):
        if not part:
            continue
        if not isinstance(node, dict) or part not in node:
            raise ValueError("$ref 를 찾지 못함: " + ref)
        node = node[part]
    return node


def validate(value, schema, root=None, where="$"):
    """value 를 schema 로 본다. 틀린 곳 글 목록을 돌려준다."""
    if root is None:
        root = schema
    errors = []
    if not isinstance(schema, dict):
        return errors
    if "$ref" in schema:
        try:
            target = _resolve(root, schema["$ref"])
        except ValueError as e:
            return [where + ": " + str(e)]
        return validate(value, target, root, where)

    if "type" in schema:
        kinds = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
        if not any(TYPE_CHECKS[k](value) for k in kinds):
            return [where + ": 꼴이 " + "/".join(kinds) + " 이어야 하는데 " + type(value).__name__ + " 임"]

    if "const" in schema and value != schema["const"]:
        errors.append(where + ": 값이 " + repr(schema["const"]) + " 이어야 하는데 " + repr(value) + " 임")
    if "enum" in schema and value not in schema["enum"]:
        errors.append(where + ": 값 " + repr(value) + " 이(가) 허용 목록 " + repr(schema["enum"]) + " 에 없음")

    if _is_number(value):
        if "minimum" in schema and value < schema["minimum"]:
            errors.append(where + ": " + repr(value) + " 이(가) 최소 " + repr(schema["minimum"]) + " 보다 작음")
        if "maximum" in schema and value > schema["maximum"]:
            errors.append(where + ": " + repr(value) + " 이(가) 최대 " + repr(schema["maximum"]) + " 보다 큼")
        if "exclusiveMinimum" in schema and value <= schema["exclusiveMinimum"]:
            errors.append(where + ": " + repr(value) + " 은(는) " + repr(schema["exclusiveMinimum"]) + " 보다 커야 함")

    if isinstance(value, str) and "minLength" in schema and len(value) < schema["minLength"]:
        errors.append(where + ": 글이 비었거나 너무 짧음")

    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            errors.append(where + ": 항목이 " + str(len(value)) + "개 — 적어도 " + str(schema["minItems"]) + "개")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            errors.append(where + ": 항목이 " + str(len(value)) + "개 — 많아도 " + str(schema["maxItems"]) + "개")
        if "items" in schema:
            for i, item in enumerate(value):
                errors.extend(validate(item, schema["items"], root, where + "[" + str(i) + "]"))

    if isinstance(value, dict):
        for key in schema.get("required", []):
            if key not in value:
                errors.append(where + ": 필수 칸 '" + key + "' 이(가) 없음")
        if "minProperties" in schema and len(value) < schema["minProperties"]:
            errors.append(where + ": 칸이 비었음")
        props = schema.get("properties", {})
        extra = schema.get("additionalProperties", True)
        for key, item in value.items():
            sub = where + "." + key
            if key in props:
                errors.extend(validate(item, props[key], root, sub))
            elif extra is False:
                errors.append(sub + ": 꼴에 없는 칸")
            elif isinstance(extra, dict):
                errors.extend(validate(item, extra, root, sub))

    if "oneOf" in schema:
        results = [validate(value, branch, root, where) for branch in schema["oneOf"]]
        passed = [r for r in results if not r]
        if not passed:
            closest = min(results, key=len)
            errors.append(where + ": 정해 둔 꼴 가운데 맞는 것이 없음 — 가장 가까운 꼴의 틀린 곳:")
            errors.extend("  " + e for e in closest)
        elif len(passed) > 1:
            errors.append(where + ": 정해 둔 꼴 여럿에 함께 맞음(하나만 맞아야 함)")
    return errors
