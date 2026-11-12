import contextlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import types
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from promptflow_cli import runtime
from promptflow_cli.progress import consume
from promptflow_cli.client import ApiError, stream_events
from rich.console import Console


class RuntimeTests(unittest.TestCase):
    def test_parallel_steps_overlap_then_join_in_order(self):
        r=self.runner([{'id':str(i),'type':'recipe','recipe_id':'__promptflow_value','parallel_group':'work','params':{'value':i}} for i in range(6)])
        barrier=threading.Barrier(3,timeout=3)
        lock=threading.Lock()
        active=0
        peak=0
        def work(step,scope):
            nonlocal active,peak
            with lock:
                active+=1
                peak=max(peak,active)
            barrier.wait()
            time.sleep(.01)
            with lock: active-=1
            return {'value':step['params']['value']}
        with patch.object(r,'recipe',side_effect=work): result=r.execute({'text':'input'})
        self.assertEqual(peak,3)
        self.assertEqual([row['value'] for row in result.values()],list(range(6)))

    def test_parallel_rejects_dependencies_hidden_in_prompt_files(self):
        (self.root/'prompts').mkdir()
        (self.root/'prompts/b.txt').write_text('Use {{a.text}}',encoding='utf-8')
        r=self.runner([{'id':'a','type':'claude','parallel_group':'work'},{'id':'b','type':'claude','parallel_group':'work','user_prompt':'__PROMPT_REF__:b'}])
        with patch.object(runtime,'request_json') as provider:
            with self.assertRaisesRegex(runtime.RunError,'dependency is not ready'): r.execute({'text':'input'})
            provider.assert_not_called()

    def test_starter_resource_is_editable_and_cannot_escape_bundle(self):
        (self.root/'resources').mkdir()
        (self.root/'resources/starter.html').write_text('<html>My edited starter</html>',encoding='utf-8')
        self.assertEqual(runtime.resolve('__RESOURCE_REF__:resources/starter.html',{},self.root),'<html>My edited starter</html>')
        with self.assertRaises(runtime.RunError): runtime.resolve('__RESOURCE_REF__:../outside.html',{},self.root)

    def test_cli_uses_canonical_api_and_migrates_old_default(self):
        from promptflow_cli import config
        with patch.dict(os.environ,{},clear=True),patch.object(config,'load_config',return_value={'server':'https://www.missinglink.build/'}):
            self.assertEqual(config.resolve_server(),'https://missinglink.build')
            self.assertEqual(config.resolve_server('http://localhost:8787/'),'http://localhost:8787')

    def test_named_input_preparation_generates_then_runs_saved_workflow(self):
        r=self.runner([{'id':'summary','type':'claude','user_prompt':'Summarize {{user_text}}'}])
        plan_json={'name':'Synthetic labels demo','steps':[{'id':'seed','type':'claude','user_prompt':'Generate labeled synthetic examples'}], 'inputs_map':{'text':'{{seed.text}}'}}
        replies=[{'content':[{'type':'text','text':json.dumps(plan_json)}]}, {'content':[{'type':'text','text':'SYNTHETIC examples'}]}, {'content':[{'type':'text','text':'Finished summary'}]}]
        with patch.dict(os.environ,{'ANTHROPIC_API_KEY':'qa'},clear=True),patch.object(runtime,'request_json',side_effect=replies) as provider:
            plan=r.plan_inputs({},'Generate synthetic input first','Named test')
            inputs=r.prepare_inputs({},plan)
            out=r.execute(inputs)
        self.assertEqual(plan['name'],'Named test')
        self.assertEqual(out['summary']['text'],'Finished summary')
        self.assertEqual(provider.call_args_list[-1].args[2]['messages'][0]['content'][0]['text'],'Summarize SYNTHETIC examples')

    def test_preparation_can_research_then_generate_an_image_and_rejects_unknown_tools(self):
        r=self.runner([{'id':'summary','type':'claude'}],input_kinds=['image'])
        plan={'name':'Research visual','steps':[
            {'id':'research','type':'recipe','recipe_id':'brave_web_search','params':{'query':'urban heat islands'}},
            {'id':'image','type':'recipe','recipe_id':'gpt_image_2','params':{'prompt':'Illustrate {{research.text}}'}},
        ],'inputs_map':{'image':'{{image.image_url}}'}}
        with patch.dict(os.environ,{'ANTHROPIC_API_KEY':'qa','BRAVE_API_KEY':'qa','OPENAI_API_KEY':'qa'},clear=True),patch.object(runtime,'request_json',return_value={'content':[{'type':'text','text':json.dumps(plan)}]}):
            prepared=r.plan_inputs({},'Research and create an input image')
        with patch.object(r,'recipe',side_effect=[{'text':'Verified evidence'}, {'image_url':'https://example.test/image.png'}]) as tools:
            inputs=r.prepare_inputs({},prepared)
        self.assertEqual(inputs['image'],'https://example.test/image.png')
        self.assertEqual(tools.call_count,2)
        plan['steps'][0]['recipe_id']='unknown_tool'
        with patch.dict(os.environ,{'ANTHROPIC_API_KEY':'qa'},clear=True),patch.object(runtime,'request_json',return_value={'content':[{'type':'text','text':json.dumps(plan)}]}):
            with self.assertRaisesRegex(runtime.RunError,'unavailable tool'):r.plan_inputs({},'Research')

    def test_step_model_and_output_limit_are_respected(self):
        r=self.runner([{'id':'one','type':'claude','text_model':'claude-haiku-5-5','max_tokens':4096}])
        r.max_output_tokens=1024
        with patch.dict(os.environ,{'ANTHROPIC_API_KEY':'qa'}),patch.object(runtime,'request_json',return_value={'content':[{'type':'text','text':'Done'}]}) as provider:
            r.execute({'text':'input'})
        body=provider.call_args.args[2]
        self.assertEqual(body['model'],'claude-haiku-5-5')
        self.assertEqual(body['max_tokens'],1024)

    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.root=Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)

    def runner(self,steps,**extra):
        (self.root/'manifest.json').write_text(json.dumps({'format':'promptflow/1','steps':steps,'input_kinds':['text'],**extra}),encoding='utf-8')
        return runtime.Runtime(self.root,self.root/'outputs')

    def test_search_and_summary_use_real_contracts_and_resolve_prompts(self):
        (self.root/'prompts').mkdir()
        (self.root/'prompts/summary.txt').write_text('Summarize {{search.text}} for {{user_text}}',encoding='utf-8')
        r=self.runner([
            {'id':'search','type':'recipe','recipe_id':'brave_web_search','params':{'query':'{{user_text}}'}},
            {'id':'summary','type':'claude','user_prompt':'__PROMPT_REF__:summary','output_format':'text'},
        ])
        calls=[]
        def provider(url,headers,payload=None):
            calls.append((url,headers,payload))
            if 'brave.com' in url: return {'web':{'results':[{'title':'Paper','url':'https://example.org','description':'Evidence'}]}}
            return {'content':[{'type':'thinking','thinking':'PRIVATE'}, {'type':'text','text':'Three useful bullets'}]}
        with patch.dict(os.environ,{'BRAVE_API_KEY':'qa-search','ANTHROPIC_API_KEY':'qa-ai'},clear=True),patch.object(runtime,'request_json',provider):
            r.preflight()
            outputs=r.execute({'text':'holographic displays'})
        self.assertEqual(outputs['summary']['text'],'Three useful bullets')
        self.assertEqual(len(calls),2)
        self.assertIn('Evidence',calls[1][2]['messages'][0]['content'][0]['text'])
        self.assertNotIn('fal',str(calls))

    def test_loops_preserve_typed_json_and_isolate_each_iteration(self):
        recipe=self.root/'echo.py';recipe.write_text('def run(params,scope):\n return {"text":params["value"]}\n')
        r=self.runner([
            {'id':'make','type':'claude','user_prompt':'{{user_text}}','output_format':'json'},
            {'id':'loop','type':'loop','iterate_over':'make.parsed.items','as':'item','body':[{'id':'echo','type':'recipe','recipe_id':'echo','params':{'value':'{{item}}'}}]},
        ],custom_recipes=[{'id':'echo','module':'echo.py'}])
        with patch.object(runtime,'request_json',return_value={'content':[{'type':'text','text':'```json\n{"items":[true, {"value":3}, "last"]}\n```'}]}),patch.dict(os.environ,{'ANTHROPIC_API_KEY':'qa'}):
            out=r.execute({'text':'test'})
        self.assertEqual([x['echo']['text'] for x in out['loop']],[True,{'value':3},'last'])

    def test_failed_json_does_not_run_later_provider(self):
        r=self.runner([{'id':'a','type':'claude','output_format':'json'},{'id':'b','type':'claude'}])
        with patch.object(runtime,'request_json',return_value={'content':[{'type':'text','text':'not JSON'}]}) as provider,patch.dict(os.environ,{'ANTHROPIC_API_KEY':'qa'}):
            with self.assertRaisesRegex(runtime.RunError,'invalid JSON'):r.execute({'text':'test'})
            self.assertEqual(provider.call_count,1)

    def test_secret_values_never_print_when_tools_echo_them(self):
        (self.root/'echo.py').write_text('def run(params,scope):\n return params\n')
        self.runner([{'id':'echo','type':'recipe','recipe_id':'echo','params':{'value':'{{secret.demo}}'}}],custom_recipes=[{'id':'echo','module':'echo.py'}])
        stdout,stderr=io.StringIO(),io.StringIO()
        with patch.dict(os.environ,{'PROMPTFLOW_SECRET_DEMO':'secret-"value"'}),contextlib.redirect_stdout(stdout),contextlib.redirect_stderr(stderr):
            status=runtime.main(self.root,['--text','test','--output-dir',str(self.root/'results')])
        self.assertEqual(status,0)
        self.assertEqual(json.loads(stdout.getvalue())['echo']['value'],'[redacted]')
        self.assertNotIn('secret-',stderr.getvalue())

    def test_archive_traversal_rejected_before_writing(self):
        file=self.root/'bad.promptflow'
        with zipfile.ZipFile(file,'w') as z:z.writestr('../escape.txt','bad')
        with self.assertRaisesRegex(runtime.RunError,'outside'):
            with runtime.bundle_root(file):pass

    def test_prompt_and_secret_templates_resolve_nested_values(self):
        with patch.dict(os.environ,{'PROMPTFLOW_SECRET_TOKEN':'value'}):
            self.assertEqual(runtime.resolve({'a':'{{items.0}}','b':'Bearer {{secret.token}}'}, {'items':[False]},self.root),{'a':False,'b':'Bearer value'})

    def test_progress_is_public_activity_and_returns_without_stream_close(self):
        def events():
            yield 'stage',{'stage':'search'}
            yield 'thinking',{'text':'PRIVATE_MODEL_NARRATIVE'}
            yield 'stage',{'stage':'validating'}
            yield 'done',{'ok':True}
            raise AssertionError('Must stop on terminal event')
        buffer=io.StringIO()
        result=consume(events(),Console(file=buffer,color_system=None))
        self.assertTrue(result['ok'])
        self.assertIn('Searching',buffer.getvalue())
        self.assertIn('Thinking through',buffer.getvalue())
        self.assertNotIn('PRIVATE_MODEL',buffer.getvalue())

    def test_interruption_and_error_are_not_success_or_automatic_replay(self):
        console=Console(file=io.StringIO())
        with self.assertRaisesRegex(ApiError,'connection ended'):consume(iter([('stage',{'stage':'planning'})]),console)
        with self.assertRaisesRegex(ApiError,'No access'):consume(iter([('done',{'ok':False,'message':'No access'})]),console)

    def test_multiline_stream_frames_and_terminal_event(self):
        def lines():
            yield from ['event: stage','data: {"stage":','data: "validating"}','','event: thinking','data: private narrative','','event: done','data: {"ok":true}','','must not read']
            raise AssertionError('Must not wait for the connection to close')
        events=list(stream_events(lines()))
        self.assertEqual(events,[('stage',{'stage':'validating'}),('thinking',{}),('done',{'ok':True})])

    def test_custom_requirements_fail_before_tool_execution(self):
        r=self.runner([])
        (self.root/'requirements.txt').write_text('promptflow-nonexistent-qa-package>=1.0\n')
        with self.assertRaisesRegex(runtime.RunError,'Missing Python packages'):r.preflight()

    def test_local_image_aliases_and_generated_file_urls_feed_media_steps(self):
        photo=self.root/'my photo.png';photo.write_bytes(b'fixture')
        r=self.runner([{'id':'media','type':'recipe','recipe_id':'image','model':'flux_pro_v11_ultra','endpoint':'fal-ai/flux-pro/v1.1-ultra','fal_arguments':{'image_url':'{{INPUT_IMAGE_URL}}','prompt':'{{user_text}}'}}],input_kinds=['text','image'])
        uploads=[];calls=[]
        def upload(path):uploads.append(path);return 'https://fixture.invalid/image.png'
        def subscribe(endpoint,arguments,with_logs):calls.append((endpoint,arguments));return {'images':[{'url':'https://fixture.invalid/result.png'}]}
        fake=types.SimpleNamespace(upload_file=upload,subscribe=subscribe)
        with patch.dict(sys.modules,{'fal_client':fake}):
            result=r.execute({'text':'A caption','image_url':photo.as_uri()})
        self.assertEqual(uploads,[str(photo)])
        self.assertEqual(calls[0][1]['image_url'],'https://fixture.invalid/image.png')
        self.assertEqual(result['media']['url'],'https://fixture.invalid/result.png')

    def test_document_result_contains_saved_html_and_escaped_content(self):
        r=self.runner([{'id':'doc','type':'recipe','recipe_id':'assemble_document','params':{'title':'Research','sections':[{'heading':'Result','body':'{{user_text}}'}]}}])
        result=r.execute({'text':'<script>bad()</script>'})['doc']
        self.assertTrue(Path(result['path']).is_file())
        self.assertIn('&lt;script&gt;',result['html'])
        self.assertNotIn('<script>bad()',result['html'])

    def test_missing_media_fails_without_provider_calls(self):
        r=self.runner([],input_kinds=['image'])
        with self.assertRaisesRegex(runtime.RunError,'does not exist'):r.input_scope({'image':str(self.root/'missing.png')})


if __name__=='__main__':unittest.main()
