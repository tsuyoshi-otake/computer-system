int main() {
  int total = 0;
  for (int i = 1; i <= 1500; i++) {
    int term = i * i + 3 * i + 7;
    total = total + term;
  }
  printf("%d\n", total);
  return 0;
}
