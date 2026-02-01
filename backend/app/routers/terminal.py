from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import os
import pty
import fcntl
import struct
import termios
import asyncio
import logging


router = APIRouter(
    prefix="/terminal",
    tags=["terminal"],
)


logger = logging.getLogger("uvicorn")


@router.websocket("/ws")
async def websocket_terminal(websocket: WebSocket):
    await websocket.accept()

    # Create PTY
    master_fd, slave_fd = pty.openpty()

    # Start shell
    shell = os.environ.get("SHELL", "/bin/bash")
    pid = os.fork()

    if pid == 0:
        # Child process
        os.setsid()
        os.dup2(slave_fd, 0)
        os.dup2(slave_fd, 1)
        os.dup2(slave_fd, 2)

        # Close fds which are not needed
        os.close(master_fd)
        os.close(slave_fd)

        # Execute shell
        os.execv(shell, [shell, "-l"])  # Login shell

    else:
        # Parent process (FastAPI)
        os.close(slave_fd)

        # Non-blocking read
        fl = fcntl.fcntl(master_fd, fcntl.F_GETFL)
        fcntl.fcntl(master_fd, fcntl.F_SETFL, fl | os.O_NONBLOCK)

        try:
            while True:
                # Select loop to handle both websocket and pty
                # But since websocket is valid asyncio, we can use asyncio.to_thread or run_in_executor
                # However, simpler pattern is creating a reader task for PTY

                # We need to multiplex specific events.
                # 1. WebSocket receive -> Write to master_fd
                # 2. Master_fd read -> Send to WebSocket

                # Check for PTY output
                await asyncio.sleep(0.01)  # Simple polling prevents high CPU usage if select not used

                # Attempt to read from PTY
                try:
                    output = os.read(master_fd, 10240)
                    if output:
                        await websocket.send_text(output.decode("utf-8", errors="ignore"))
                except BlockingIOError:
                    pass
                except OSError:
                    break

                # Check for WS input
                # This is tricky because websocket.receive is awaitable.
                # We need proper async gathering.

                # Let's refactor to use asyncio.gather or similar
                # But we can't easily poll websocket.receive without blocking PTY read.
                # So we spawn a reader/writer task.
                break  # breaking out to use a better loop structure below

        except Exception as e:
            logger.error(f"Error initializing terminal loop: {e}")

        # Better async loop
        try:
            loop = asyncio.get_running_loop()

            async def write_to_pty():
                while True:
                    try:
                        data = await websocket.receive_text()
                        # specific command to resize? e.g. "RESIZE:rows,cols"
                        if data.startswith("RESIZE:"):
                            _, dims = data.split(":")
                            rows, cols = map(int, dims.split(","))
                            # Set window size
                            winsize = struct.pack("HHHH", rows, cols, 0, 0)
                            fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)
                        else:
                            os.write(master_fd, data.encode())
                    except WebSocketDisconnect:
                        break
                    except Exception:
                        break

            # Run both tasks
            # IMPORTANT: read_from_pty needs to be slightly smarter or run concurrently.
            # Using add_reader is the most efficient way for PTY.

            queue = asyncio.Queue()

            def pty_reader():
                try:
                    data = os.read(master_fd, 10240)
                    if data:
                        asyncio.run_coroutine_threadsafe(queue.put(data), loop)
                    else:
                        # EOF
                        pass
                except (OSError, BlockingIOError):
                    pass

            loop.add_reader(master_fd, pty_reader)

            async def consumer():
                while True:
                    data = await queue.get()
                    await websocket.send_bytes(data)  # Send raw bytes/text

            consumer_task = asyncio.create_task(consumer())
            writer_task = asyncio.create_task(write_to_pty())

            await asyncio.wait(
                [consumer_task, writer_task],
                return_when=asyncio.FIRST_COMPLETED
            )

            # Cleanup
            consumer_task.cancel()
            writer_task.cancel()
            loop.remove_reader(master_fd)

        except Exception as e:
            logger.error(f"Terminal error: {e}")

        finally:
            os.close(master_fd)
