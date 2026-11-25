"""거리 셈(순수 — 로그 없음, 값은 인자로만 받는다).

구면 코사인 법칙을 쓴다(숫자 상수가 들지 않는다). km 단위 거리에서는 배정도로 충분하다.
"""
import math


def sphere_km(a, b, radius_km):
    lat1, lng1 = (math.radians(x) for x in a)
    lat2, lng2 = (math.radians(x) for x in b)
    c = math.sin(lat1) * math.sin(lat2) + math.cos(lat1) * math.cos(lat2) * math.cos(lng2 - lng1)
    return radius_km * math.acos(min(1.0, max(-1.0, c)))


def line_length_km(points, radius_km):
    return sum(sphere_km(p, q, radius_km) for p, q in zip(points, points[1:]))
