import {it,expect} from 'vitest';
import {endpoint,input} from '@/server/api';
import {z} from 'zod';
it('does not leak internal exception secrets',async()=>{const response=await endpoint(async()=>{throw new Error('postgres://secret and token=private');})(new Request('https://example.test'));const raw=await response.text();expect(response.status).toBe(500);expect(raw).not.toContain('secret');expect(raw).not.toContain('private');expect(raw).not.toContain('postgres://');expect(response.headers.get('Cache-Control')).toBe('private, no-store');});
it('rejects oversized request bodies and malformed JSON',async()=>{await expect(input(new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:'x'.repeat(100)})}),z.object({value:z.string()}),50)).rejects.toThrow();await expect(input(new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'}),z.object({}))).rejects.toThrow();});
