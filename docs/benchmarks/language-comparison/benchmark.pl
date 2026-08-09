my $total = 0;
for my $i (1..1500) {
  my $term = $i * $i + 3 * $i + 7;
  $total = $total + $term;
}
die "checksum mismatch\n" unless $total == 1129513000;
