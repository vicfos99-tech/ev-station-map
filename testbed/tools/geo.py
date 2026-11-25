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


FULL_CIRCLE_DEG = math.degrees(math.tau)


def bearing_deg(a, b):
    """a → b 의 진행 방향(북에서 시계 방향 도, 0 이상 한 바퀴 미만)."""
    lat1, lng1 = (math.radians(x) for x in a)
    lat2, lng2 = (math.radians(x) for x in b)
    y = math.sin(lng2 - lng1) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(lng2 - lng1)
    return math.degrees(math.atan2(y, x)) % FULL_CIRCLE_DEG


def offset_point(p, dist_km, bearing, radius_km):
    """p 에서 bearing(도) 방향으로 dist_km 옮긴 점(구면)."""
    lat1, lng1 = (math.radians(x) for x in p)
    d = dist_km / radius_km
    br = math.radians(bearing)
    lat2 = math.asin(math.sin(lat1) * math.cos(d) + math.cos(lat1) * math.sin(d) * math.cos(br))
    lng2 = lng1 + math.atan2(math.sin(br) * math.sin(d) * math.cos(lat1), math.cos(d) - math.sin(lat1) * math.sin(lat2))
    return [math.degrees(lat2), math.degrees(lng2)]
