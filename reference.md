# 【代码】逆向拿到 Claude Code cch 生成算法 

**作者：Neo **  
**时间：2026 年 4月 3 日 20:56**  
**原贴：** <https://linux.do/t/topic/1892285>  

就是个小玩具，直接放代码吧：

```python
import xxhash

body = open('/tmp/body.json', 'rb').read()  # body 中 cch=00000
h = xxhash.xxh64(body, seed=0x6E52736AC806831E).intdigest()
cch = f"{h & 0xFFFFF:05x}"

print(cch)
```

懂的一看就知道用了，无任何使用限制，无任何速率限制。

就是简单展示一下，忆往昔逆向岁月，没有别的意思 ---

原来早就有人发过了啊。那我就简单记录一下逆向过程吧，其实还挺简单的。我是在 macOS arm64 上操作的。

首先给 `claude` bin 文件去除签名，然后重新签名。否则无法 attach 进程。

重新签名后的文件，使用 `HTTPS_PROXY=http://127.0.0.1:8888 NODE_TLS_REJECT_UNAUTHORIZED=0 ./claude-unsigned` 启动，直接能拦截网络请求。

直接掏出 `lldb -p <pid>` 给 attach 上。

拿出 `Charles`，我们要做的就是在 `https://api.anthropic.com/v1/messages` 请求上加断点。

反正思路就是 `Charles` 拦截到请求后，立刻 `(lldb) process interrupt` 给断下来。

一通搜索（这是个力气活，还需要一些运气，枯燥且乏味，按下不表），找到了几个可疑的点 `0x1018c6ef8`、`0x101b27200`、`0x101f798e0` 断点直接上去，然后 `continue`。

```python
(lldb) breakpoint delete
(lldb) breakpoint set -a 0x1018c6ef8
(lldb) breakpoint set -a 0x101b27200
(lldb) breakpoint set -a 0x101f798e0
(lldb) continue
```

发消息，断下来，出现了好运气：

```
(lldb) bt                                                                                                                                                                                                                                           
* thread #5, name = 'HTTP Client', stop reason = breakpoint 3.1                                                                                                                                                                                       
  * frame #0: 0x00000001018c6ef8 claude-unsigned`___lldb_unnamed_symbol_101146558 + 2464                                                                                                                                                              
    frame #1: 0x00000001018c8dac claude-unsigned`___lldb_unnamed_symbol_10114877c + 1584                                                                                                                                                              
    frame #2: 0x00000001017a9890 claude-unsigned`___lldb_unnamed_symbol_1010297e0 + 176                                                                                                                                                               
    frame #3: 0x0000000101b75714 claude-unsigned`___lldb_unnamed_symbol_1013f564c + 200                                                                                                                                                               
    frame #4: 0x0000000100fc808c claude-unsigned`___lldb_unnamed_symbol_100847ee8 + 420                                                                                                                                                               
    frame #5: 0x0000000100fc81a4 claude-unsigned`___lldb_unnamed_symbol_1008480c8 + 220                                                                                                                                                               
    frame #6: 0x0000000101a68b74 claude-unsigned`___lldb_unnamed_symbol_1012e8ad0 + 164                                                                                                                                                               
    frame #7: 0x00000001017b8ecc claude-unsigned`___lldb_unnamed_symbol_101038c40 + 652                                                                                                                                                               
    frame #8: 0x000000018d4f7c08 libsystem_pthread.dylib`_pthread_start + 136                                                                                                                                                                         
(lldb) register read x0 x1 x2 x3                                                                                                                                                                                                                      
      x0 = 0x2d8d9909d683c61e                                                                                                                                                                                                                         
      x1 = 0x7b19097c6c667dc3                                                                                                                                                                                                                         
      x2 = 0x6f34564e065c4298                                                                                                                                                                                                                         
      x3 = 0x000000017064d9fc                                                                                                                                                                                                                         
(lldb) memory read $x0 --count 32                                                                                                                                                                                                                     
error: memory read failed for 0xffff9909d683c600                                                                                                                                                                                                      
(lldb) memory read $x1 --count 32                                                                                                                                                                                                                     
error: memory read failed for 0x97c6c667c00                                                                                                                                                                                                           
(lldb) memory read $x2 --count 32                                                                                                                                                                                                                     
error: memory read failed for 0x564e065c4200                                                                                                                                                                                                          
(lldb) memory read $x3 --count 32                                                                                                                                                                                                                     
0x17064d9fc: 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00  ................                                                                                                                                                                        
0x17064da0c: 00 00 00 00 00 00 00 00 00 00 00 00 63 63 68 3d  ............cch= 
```

看到没，神秘的 `cch=` 终于出来了。

赶快趁热打铁，多看一点：

```
(lldb)  memory read 0x17064da0c --count 64                                                                                                                                                                                                          
0x17064da0c: 00 00 00 00 00 00 00 00 00 00 00 00 63 63 68 3d  ............cch=                                                                                                                                                                        
0x17064da1c: 30 30 30 30 30 67 65 73 74 69 6d 65 6f 75 74 2d  00000gestimeout-                                                                                                                                                                        
0x17064da2c: 76 65 72 73 69 6f 6e 1d de 08 e4 25 11 00 b1 f1  version....%....                                                                                                                                                                        
0x17064da3c: ff e1 23 e5 e7 90 bf 8e 99 24 40 43 c7 1c 4e a1  ..#......$@C..N.  
```

此时 `cch` 还未替换，也看到了激动人心的头 `gestimeout-version`。那还犹豫啥，它马上就要替换了，直接对这块内存打上写断点：

```cpp
  (lldb) watchpoint set expression -s 5 -w write -- (char*)0x17064da18
  (lldb) continue
```

鱼儿终于上钩了：

```
(lldb) watchpoint set expression -s 5 -w write -- (char*)0x17064da18                                                                                                                                                                                
Watchpoint created: Watchpoint 1: addr = 0x17064da18 size = 5 state = enabled type = w                                                                                                                                                                
    watchpoint spec = '(char*)0x17064da18'                                                                                                                                                                                                            
    watchpoint resources:                                                                                                                                                                                                                             
       #0: addr = 0x17064da18 size = 8                                                                                                                                                                                                                
Watchpoint 1 hit:                                                                                                                                                                                                                                     
                                                                                                                                                                                                                                                      
new value: 0x303030303d686363                                                                                                                                                                                                                         
(lldb) continue                                                                                                                                                                                                                                       
Process 52418 resuming                                                                                                                                                                                                                                
                                                                                                                                                                                                                                                      
Watchpoint 1 hit:                                                                                                                                                                                                                                     
old value: 0x303030303d686363                                                                                                                                                                                                                         
new value: 0x00000001049e8940                                                                                                                                                                                                                         
Process 52418 stopped                                                                                                                                                                                                                                 
* thread #5, name = 'HTTP Client', stop reason = watchpoint 1                                                                                                                                                                                         
    frame #0: 0x00000001018c6fe4 claude-unsigned`___lldb_unnamed_symbol_101146558 + 2700                                                                                                                                                              
claude-unsigned`___lldb_unnamed_symbol_101146558:                                                                                                                                                                                                     
->  0x1018c6fe4 <+2700>: adrp   x8, 9491                                                                                                                                                                                                              
    0x1018c6fe8 <+2704>: ldr    q0, [x8, #0xf90]                                                                                                                                                                                                      
    0x1018c6fec <+2708>: stur   q0, [x29, #-0x78]                                                                                                                                                                                                     
    0x1018c6ff0 <+2712>: adrp   x8, 10876                                                                                                                                                                                                             
Target 0: (claude-unsigned) stopped.                                                                                                                                                                                                                  
(lldb) bt                                                                                                                                                                                                                                             
* thread #5, name = 'HTTP Client', stop reason = watchpoint 1                                                                                                                                                                                         
  * frame #0: 0x00000001018c6fe4 claude-unsigned`___lldb_unnamed_symbol_101146558 + 2700                                                                                                                                                              
    frame #1: 0x00000001018c8dac claude-unsigned`___lldb_unnamed_symbol_10114877c + 1584                                                                                                                                                              
    frame #2: 0x00000001017a9890 claude-unsigned`___lldb_unnamed_symbol_1010297e0 + 176                                                                                                                                                               
    frame #3: 0x0000000101b75714 claude-unsigned`___lldb_unnamed_symbol_1013f564c + 200                                                                                                                                                               
    frame #4: 0x0000000100fc808c claude-unsigned`___lldb_unnamed_symbol_100847ee8 + 420                                                                                                                                                               
    frame #5: 0x0000000100fc81a4 claude-unsigned`___lldb_unnamed_symbol_1008480c8 + 220                                                                                                                                                               
    frame #6: 0x0000000101a68b74 claude-unsigned`___lldb_unnamed_symbol_1012e8ad0 + 164                                                                                                                                                               
    frame #7: 0x00000001017b8ecc claude-unsigned`___lldb_unnamed_symbol_101038c40 + 652                                                                                                                                                               
    frame #8: 0x000000018d4f7c08 libsystem_pthread.dylib`_pthread_start + 136  
`___lldb_unnamed_symbol_101146558 + 2700` 就是我们的目的地。

`(lldb) image list claude-unsign`

简单算一下偏移得出：`0x10342e558`，如果你们刚好也是 macOS arm64 `cc 2.1.91` 应该根据偏移，能复线这个过程，看到这段函数。

简单来说这个函数就是：

1. 找到 `"system":[`
2. 在后面 300 字节搜索 `cch=00000`
3. hash 计算整个 body，seed 直接在代码里 `0x6E52736AC806831E`
4. 取 hash 结果低 20bits 转成 hex
5. 修改 `00000` 到我们计算的 hash

至于为什么是 `xxhash64`，hash 算法在 `0x102faf608` 也就是 `sub_102FAF608` 熟练的佬友，进去一看到 `0x3D4D51C2D82B14B1` 和 `0x9E3779B185EBCA87` 这两个常数就知道了。

---

整个过程就是这么简单，但个把小时的埋头寻找，确实乏味。

