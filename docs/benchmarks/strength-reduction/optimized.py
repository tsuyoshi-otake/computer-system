total = 0
term = 11
delta = 6
for i in range(1, 1501):
    total = total + term
    term = term + delta
    delta = delta + 2
print(total)
