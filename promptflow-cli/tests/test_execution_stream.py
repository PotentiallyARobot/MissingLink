import json
import unittest
from unittest.mock import patch
import httpx
from promptflow_cli.client import PromptFlowClient, ApiError

class ExecutionStreamTests(unittest.TestCase):
    def run_client(self, handler):
        factory=httpx.Client
        with patch('promptflow_cli.client.httpx.Client',side_effect=lambda **kw:factory(transport=httpx.MockTransport(handler),**kw)):
            return PromptFlowClient('https://example.test','test-only').execute('p')

    def test_heartbeats_then_artifact_result(self):
        calls=[]
        def handler(req):
            calls.append(req.url.path)
            return httpx.Response(200,text='event: heartbeat\ndata: {}\n\nevent: done\ndata: '+json.dumps({'ok':True,'status':'complete','outputs':[{'kind':'image'}]})+'\n\n')
        self.assertEqual(self.run_client(handler)['outputs'][0]['kind'],'image')
        self.assertEqual(calls,['/api/promptflow/execute/stream'])

    def test_transport_failure_or_early_eof_only_polls_status(self):
        for failure in ('disconnect','eof','reconnecting'):
            calls=[]
            def handler(req):
                calls.append(req.url.path)
                if req.url.path.endswith('/status'):return httpx.Response(200,json={'ok':True,'status':'running'})
                if failure=='disconnect':raise httpx.RemoteProtocolError('closed')
                return httpx.Response(200,text='event: done\ndata: {"ok":true,"reconnecting":true}\n\n' if failure=='reconnecting' else '')
            self.assertEqual(self.run_client(handler)['status'],'running')
            self.assertEqual(calls,['/api/promptflow/execute/stream','/api/promptflow/status'])

    def test_rejected_execution_is_not_retried(self):
        calls=[]
        def handler(req):
            calls.append(req.url.path)
            return httpx.Response(200,text='event: done\ndata: {"ok":false,"error":"insufficient_tokens"}\n\n')
        with self.assertRaises(ApiError):self.run_client(handler)
        self.assertEqual(len(calls),1)
