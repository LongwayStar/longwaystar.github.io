**系统与工具：**
```信息
系统使用：Ubuntu 26.04.1 LTS
WSL 版本: 3.0.4.0
```
# 一、学习笔记

## 1.文件与目录的基本操作

### `ls` *（list files）* 用于显示当前目录下的所有文件
- **`-a`** 参数用于显示包括隐藏文件（以.开头的文件）的所有文件
- **`-l`** 参数用于显示各个文件的详细信息
    - 如对于 `drwxr-xr-x   3 root root 4096  1月 30  2026 home`
    1. 文件前的字符串含义如下：
        - 第1个字符：表示**文件类型**， `l` 是**符号链接/快捷方式** （link）， `d` 是目录（directory）， `-`是**普通文件**。
            > 若目录处于`/dev` 内，则 `c` 指的是**字符设备（character）**（键盘这类"一个字符一个字符读取"的设备）， `b`指的是**块设备（block）**
        - 第2-4个字符：所有者权限。 `r` 指**可读**， `e` 指**可执行**（即运行等）， `w` 指**可写**，若为 `-` 即为无此权限。**下同**
        - 第5-7个字符：同用户组的权限。
        - 第8-10个字符：其他人的权限。
            > 第十个字符若是 **`t`**，则只有文件的所有者才能删除自己的文件 
    2. 紧接着字符串的是 **所指向该目录的文件（目录）数** （即目录下的文件（夹）数）
    3. `root root` 的部分是指该文件的所有者和所属组
    4. `4096` 部分指的是**文件或目录下索引文件的大小**，以字节记
        > 若目录处于`/dev` 内，该位置若是**数字对**，则这是给内核看的“主设备号（Major）”和“次设备号（Minor）”
    5. `1月 30  2026` 的部分指最后的修改时间

### `chmod` *（change mode）* 用于改变文件或文件夹的权限
- 对于操作指令，有以下两种表示方式
    1. **符号法** 基本格式为`chmod [对象] [操作指令] [权限] [操作文件]`
        - 对于对象：`u` (所有者), `g` (同组), `o` (其他人), `a` (所有人)
        - 对于操作指令：`+` (增加), `-` (取消), `=` (设定为)
        - 对于权限：权限：`r`（可读）,`w`（可写）, `x`（可操作），`t`（粘滞位，即仅有文件的所有者可删除该文件）
        - **eg:** 
            - `chmod u+x hello.txt` ：给文件所有者（你）增加执行权限
            - `chmod go-r hello.txt` ：让同组用户和其他人取消读取权限
    2. **数字法** 基本格式为`格式： chmod [三位数字] 文件名`
        - 三位数字分别对应 **所有者(u)、同组用户(g)、其他人(o)**
        - 数字用法有（读对应 **4**，写对应 **2**，执行对应 **1**）
            - `4`= 只读 
            - `2`= 只写
            - `6`= 读+写
            - `7`= 读+写+执行
        - 若想为该文件增添粘滞位，在三位数字前加 `1`即可 
        - **eg:**
            - `chmod 644 hello.txt`：所有者可读写，同组和其他人只能读
            - `chmod 600 private.txt`：只有所有者自己能读写，别人没有任何权限
            - `chmod 1777 folder_name`：所有人可读可写可执行，但只有所有者可删除
- 对于目录而言，目录的权限是会 **<u>覆盖</u>（不是覆写）** 目录内文件的权限
# 二、速查表（由DeepSeek整理）
## 1. 目录导航与查看 (Navigation & Listing)
用于在文件系统中定位、查看当前状态。

| 命令 | 全拼 | 作用 | 示例 |
| :--- | :--- | :--- | :--- |
| `pwd` | print work directory | 我在哪？（显示当前工作目录的绝对路径） | `pwd` |
| `ls` | list files | 这文件夹里有什么？（目录默认是蓝色的） | `ls` |
| `ls -l` | list files (long) | 看详细信息（权限、大小、时间等） | `ls -l` |
| `ls -a` | list files (all) | 【补充】查看所有文件，包括隐藏文件（以 `.` 开头的文件） | `ls -a` |
| `cd DIR` | change directory | 切换到指定的 DIR 目录 | `cd /mnt/c` |
| `cd ..` | | `..` 代表上级目录，`.` 代表当前目录 | `cd ..` |
| `cd ~` | | `~` 代表家目录，`/` 代表根目录 | `cd ~` |
| `cd -` | | 【补充】返回上一次所在的目录 | `cd -` |
| `clear` | clear | 【补充】清空终端屏幕 | `clear` |

---

## 2. 文件与目录操作 (File & Directory Management)
用于创建、复制、移动、删除文件或文件夹。

| 命令 | 全拼 | 作用 | 示例 |
| :--- | :--- | :--- | :--- |
| `touch FILE` | touch | 创建一个空文件 | `touch hello` |
| `mkdir DIR` | make directory | 创建目录（文件夹） | `mkdir temp` |
| `mkdir -p DIR` | | 【补充】递归创建多级目录（如 `mkdir -p a/b/c`） | `mkdir -p project/src` |
| `rmdir DIR` | remove directory | 删除空目录（只能删空的！） | `rmdir newdir` |
| `cp SRC DEST` | copy | 复制文件；若 DEST 是目录，则复制进去 | `cp newfile aaa` |
| `cp -r SRC DEST` | copy (recursive) | 【补充】递归复制整个目录 | `cp -r dir1 dir2` |
| `rm FILE` | remove | 删除文件，**无法恢复，谨慎！！** | `rm bbb` |
| `rm -r DIR` | remove (recursive) | 递归删除整个目录，**更谨慎！！** | `rm -r temp` |
| `rm -rf DIR` | remove (force) | 【补充】强制递归删除，**极度危险，千万别乱用！** | `rm -rf temp` |
| `mv A B` | move | 移动文件/目录，或者重命名（A移动并改名为B） | `mv aaa bbb` |

---

## 3. 文件查看与编辑 (Viewing & Editing)
用于查看文件内容和编写代码。

| 命令 | 全拼 | 作用 | 示例 |
| :--- | :--- | :--- | :--- |
| `cat FILE` | concatenate | 查看文件全部内容（适合短文件） | `cat hello.c` |
| `less FILE` | less | 【补充】分页查看文件内容，支持上下翻页，按 `q` 退出 | `less long_log.txt` |
| `head -n 10 FILE` | head | 【补充】查看文件开头前10行（默认10行） | `head -n 20 data.txt` |
| `tail -f FILE` | tail | 【补充】实时查看文件末尾内容（常用于看日志） | `tail -f app.log` |
| `vi FILE` / `vim FILE`| visual interface | 编辑文件（Linux 经典文本编辑器） | `vi hello.c` |
| `emacs FILE` | | 编辑文件（另一款强大的编辑器） | `emacs hello.c` |
| `nano FILE` | | 【补充】简单易用的新手文本编辑器 | `nano hello.c` |

---

## 4. 权限管理 (Permissions)
Linux 中一切皆文件，权限控制非常重要。

| 命令 | 全拼 | 作用 | 示例 |
| :--- | :--- | :--- | :--- |
| `chmod +x FILE` | change mode | 给文件加上执行权限 | `chmod +x run.sh` |
| `chmod -x FILE` | change mode | 收走执行权限 | `chmod -x run.sh` |
| `chmod 755 FILE` | change mode | 数字写法：`r=4、w=2、x=1`，每组加起来一位数。<br>7(4+2+1)：所有者读写执行<br>5(4+1)：所属组读执行<br>5(4+1)：其他人读执行 | `chmod 755 run.sh` |
| `sudo CMD` | superuser do | 【补充】以管理员（超级用户）身份执行命令 | `sudo ls /root` |

---

## 5. 系统与软件管理 (System & Package Management)
用于查阅文档、安装软件等系统级操作。

| 命令 | 全拼 | 作用 | 示例 |
| :--- | :--- | :--- | :--- |
| `man CMD` | manual | 查看命令帮助文档，读完按 `q` 退出 | `man ls` |
| `sudo apt-get install PKG` | | 用管理员身份安装软件（Ubuntu/Debian系） | `sudo apt-get install emacs` |
| `sudo apt-get update` | | 【补充】更新软件源列表 | `sudo apt-get update` |
| `sudo apt-get upgrade`| | 【补充】升级已安装的所有软件 | `sudo apt-get upgrade` |
| `top` / `htop` | | 【补充】实时查看系统进程和资源占用（htop需额外安装） | `top` |
| `df -h` | disk free | 【补充】查看磁盘空间使用情况（human-readable） | `df -h` |

---

## 6. 编译与运行 (Compilation & Execution)
C/C++ 等编译型语言开发常用。

| 命令 | 全拼 | 作用 | 示例 |
| :--- | :--- | :--- | :--- |
| `gcc FILE -o NAME` | GNU Compiler Collection | 编译 C 代码（不给 `-o` 就默认生成 `a.out`） | `gcc hello.c -o hello` |
| `./hello` | | 运行当前目录下的程序，`./` 不能少！（表示当前目录） | `./hello` |
| `make` | | 【补充】根据 Makefile 自动编译项目 | `make` |

---

## 7. 查找与搜索 (Searching)
【补充分类】日常开发必不可少的搜索工具。

| 命令 | 全拼 | 作用 | 示例 |
| :--- | :--- | :--- | :--- |
| `grep "keyword" FILE` | global regular expression print | 在文件中搜索指定的文本内容 | `grep "error" app.log` |
| `find DIR -name "FILE"` | find | 在指定目录下按名称查找文件 | `find . -name "*.c"` |

---