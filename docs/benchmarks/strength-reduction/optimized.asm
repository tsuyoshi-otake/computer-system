mov eax, 0
mov ecx, 1
mov edx, 11
mov ebx, 6
loop:
add eax, edx
add edx, ebx
add ebx, 2
add ecx, 1
cmp ecx, 1500
jle loop
print eax
halt
