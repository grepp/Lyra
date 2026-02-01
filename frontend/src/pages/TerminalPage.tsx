import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

export default function TerminalPage() {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termInstance = useRef<Terminal | null>(null);
  const fitAddonInstance = useRef<FitAddon | null>(null);
  const wsInstance = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    // Initialize Terminal
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      fontSize: 14,
      theme: {
        background: '#000000',
        foreground: '#ffffff',
        cursor: '#4ade80',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(terminalRef.current);
    fitAddon.fit();

    termInstance.current = term;
    fitAddonInstance.current = fitAddon;

    // WebSocket Connection
    // Use relative path to work with both local dev (proxy) and production (nginx)
    // For local dev without proxy, you might need a conditional, but for this "Docker Compose" task, we use relative.
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // If running strictly in dev mode (port 5173 -> 8000), we might need localhost:8000 override.
    // However, if we serve via Nginx, relative is correct.
    // To support both:
    const wsUrl = import.meta.env.DEV
        ? 'ws://localhost:8000/terminal/ws'
        : `${protocol}//${window.location.host}/terminal/ws`;

    const ws = new WebSocket(wsUrl);
    wsInstance.current = ws;

    ws.binaryType = 'blob'; // or 'arraybuffer'

    ws.onopen = () => {
        term.write('\r\n\x1b[32m[Connected to Host]\x1b[0m\r\n');
        // Send initial size
        const dims = { cols: term.cols, rows: term.rows };
        ws.send(`RESIZE:${dims.rows},${dims.cols}`);
    };

    ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
             term.write(event.data);
        } else {
            // Handle blob
            const reader = new FileReader();
            reader.onload = () => {
                term.write(reader.result as string);
            };
            reader.readAsText(event.data);
        }
    };

    ws.onclose = () => {
        term.write('\r\n\x1b[31m[Connection Closed]\x1b[0m\r\n');
    };

    term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(data);
        }
    });

    // Handle Window Resize
    const handleResize = () => {
        fitAddon.fit();
        if (ws.readyState === WebSocket.OPEN) {
             ws.send(`RESIZE:${term.rows},${term.cols}`);
        }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      ws.close();
      term.dispose();
    };
  }, []);

  return (
    <div className="h-full flex flex-col p-6 bg-[#18181b]">
       <header className="mb-4 flex justify-between items-center">
            <div>
                 <h2 className="text-2xl font-bold text-white">Host Terminal</h2>
                 <p className="text-gray-400 text-sm">Direct access to provider shell</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                Connected via WebSocket
            </div>
       </header>
       <div className="flex-1 bg-black rounded-xl border border-[#3f3f46] p-2 overflow-hidden shadow-2xl">
         <div ref={terminalRef} className="w-full h-full" />
       </div>
    </div>
  );
}
