mov eax, 0
mov ecx, 1
loop:
mov edx, ecx
mul edx, ecx
mov ebx, ecx
mul ebx, 3
add edx, ebx
add edx, 7
add eax, edx
add ecx, 1
cmp ecx, 1500
jle loop
print eax
halt
