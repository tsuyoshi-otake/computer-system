total = 0
for i in range(1, 1501):
    term = i * i + 3 * i + 7
    total = total + term
assert total == 1129513000
