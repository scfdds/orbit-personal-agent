import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const server = new Server({ name: 'orbit-test-tools', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
  { name: 'text_length', description: '统计文本字符数', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'not_granted', description: '未分配的测试工具', inputSchema: { type: 'object' } },
] }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  if (request.params.name !== 'text_length') throw new Error('未分配');
  return { content: [{ type: 'text', text: String([...String(request.params.arguments?.text || '')].length) }] };
});
await server.connect(new StdioServerTransport());
