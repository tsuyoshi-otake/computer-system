int main() {
  int total = 0;
  int term = 11;
  int delta = 6;
  for (int i = 1; i <= 1500; i++) {
    total = total + term;
    term = term + delta;
    delta = delta + 2;
  }
  printf("%d\n", total);
  return 0;
}
