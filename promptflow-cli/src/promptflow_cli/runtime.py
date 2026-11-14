"""Portable promptflow/1 runner, also embedded in every new download.

Standard-library runtime; only fal media steps require the optional fal-client.
Progress describes observable work, never private model reasoning or credentials.
"""
from __future__ import annotations

import argparse
import csv
import io
import base64
from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor
import html
import importlib.util
import importlib.metadata
import json
import mimetypes
import os
from pathlib import Path
import re
import sys
import tempfile
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen, url2pathname
import zipfile


PARALLEL_RECIPES = {'__promptflow_value','brave_web_search','brave_news_search','brave_image_search','gpt_image_2','assemble_document','assemble_website','assemble_files'}

def validate_parallel_groups(steps, root=None):
    def materialize(value):
        if isinstance(value, dict): return {k:materialize(v) for k,v in value.items()}
        if isinstance(value, list): return [materialize(v) for v in value]
        if root and isinstance(value, str) and value.startswith('__PROMPT_REF__:'):
            return safe_path(root, 'prompts/' + value.split(':', 1)[1] + '.txt').read_text('utf-8')
        return value
    steps = materialize(steps)
    positions = {step.get('id'): i for i, step in enumerate(steps)}
    seen = set()
    i = 0
    while i < len(steps):
        step = steps[i]
        if step.get('body'): validate_parallel_groups(step['body'], root)
        group = step.get('parallel_group')
        if not group:
            i += 1
            continue
        if not isinstance(group, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,180}', group) or group in seen:
            raise RunError('Parallel groups must be named, contiguous batches: ' + str(group))
        seen.add(group)
        end = i
        while end < len(steps) and steps[end].get('parallel_group') == group:
            member = steps[end]
            if member['type'] != 'claude' and not (member['type'] == 'recipe' and member.get('recipe_id') in PARALLEL_RECIPES):
                raise RunError('Step cannot run in parallel: ' + member['id'])
            for dependency in re.findall(r'\{\{\s*([\w-]+)', json.dumps(member)):
                if positions.get(dependency, -1) >= i:
                    raise RunError('Parallel dependency is not ready: ' + member['id'] + ' needs ' + dependency)
            end += 1
        i = end

class RunError(Exception):
    pass


def progress(message):
    print('[PromptFlow] ' + message, file=sys.stderr, flush=True)


@contextmanager
def activity(message):
    progress(message)
    done = threading.Event()
    started = time.monotonic()
    def heartbeat():
        while not done.wait(10):
            progress(f'{message} ({int(time.monotonic() - started)}s elapsed)')
    worker = threading.Thread(target=heartbeat, daemon=True)
    worker.start()
    try:
        yield
    finally:
        done.set()
        worker.join()


def request_json(url, headers, payload=None):
    data = None if payload is None else json.dumps(payload).encode('utf-8')
    try:
        with urlopen(Request(url, data=data, headers=headers), timeout=120) as response:
            if payload and payload.get('stream'):
                blocks, usage, stop_reason = {}, {}, None
                for line in response:
                    if not line.startswith(b'data:'): continue
                    raw = line[5:].strip()
                    if raw == b'[DONE]': continue
                    event = json.loads(raw)
                    kind = event.get('type')
                    if kind in ('error','response.failed'):
                        raise RunError('The text provider could not complete the response. Check provider status before retrying.')
                    if kind in ('response.completed','response.incomplete'): return event['response']
                    if kind == 'content_block_start': blocks[event['index']] = dict(event['content_block'])
                    if kind == 'content_block_delta' and event.get('delta',{}).get('type') == 'text_delta':
                        block = blocks[event['index']]
                        block['text'] = block.get('text','') + event['delta'].get('text','')
                    if kind == 'message_delta':
                        usage.update(event.get('usage',{})); stop_reason = event.get('delta',{}).get('stop_reason',stop_reason)
                    if kind == 'message_stop': return {'content':list(blocks.values()),'usage':usage,'stop_reason':stop_reason}
                raise RunError('The provider stream ended before completion.')
            return json.load(response)
    except HTTPError as exc:
        # Provider error bodies can echo user input or secrets. Keep diagnostics bounded.
        hint = {401: 'Check the provider API key.', 403: 'Check provider access.',
                429: 'Provider rate limit reached; retry later.'}.get(exc.code, 'Check the model and inputs, then retry.')
        raise RunError(f'Provider request failed (HTTP {exc.code}). {hint}') from None
    except (URLError, TimeoutError) as exc:
        raise RunError('Provider connection failed or timed out. Check your connection before retrying.') from None


def lookup(scope, path):
    value = scope
    for part in path.strip().split('.'):
        if isinstance(value, dict) and part in value:
            value = value[part]
        elif isinstance(value, list) and part.isdigit() and int(part) < len(value):
            value = value[int(part)]
        else:
            raise RunError(f'Unresolved input or step reference: {path}')
    return value


OPENAI_TEXT_MODELS = {'gpt-6-luna','gpt-6.1-terra','gpt-6.1-sol','gpt-6-astra'}

def text_model(model):
    return re.sub(r'^(?:anthropic|openai):', '', model)

def text_key(model):
    return 'OPENAI_API_KEY' if text_model(model) in OPENAI_TEXT_MODELS else 'ANTHROPIC_API_KEY'

def text_request(body):
    body = dict(body)
    body['model'] = text_model(body['model'])
    body['max_tokens'] = min(128000,body['max_tokens'])
    key = text_key(body['model'])
    if not os.environ.get(key): raise RunError('Missing API key: set ' + key + '.')
    if key == 'ANTHROPIC_API_KEY':
        if body['max_tokens'] > 8192: body['stream'] = True
        return request_json('https://api.anthropic.com/v1/messages', {
            'x-api-key':os.environ[key], 'anthropic-version':'2023-06-01', 'content-type':'application/json'},body)
    messages = []
    for message in body['messages']:
        content = message['content']
        if isinstance(content,list):
            converted = []
            for block in content:
                if block['type'] == 'text': converted.append({'type':'input_text','text':block['text']})
                elif block['type'] == 'image':
                    source = block['source']
                    converted.append({'type':'input_image','image_url':source['url'] if source['type']=='url' else 'data:'+source['media_type']+';base64,'+source['data']})
                else: raise RunError('Unsupported input for the selected OpenAI model.')
            content = converted
        messages.append({'role':message['role'],'content':content})
    data = request_json('https://api.openai.com/v1/responses',{'authorization':'Bearer '+os.environ[key],'content-type':'application/json'}, {
        'model':body['model'],'input':messages,'instructions':body.get('system',''),
        'max_output_tokens':body['max_tokens'],'reasoning':{'effort':'medium'},'store':False,'stream':True})
    if data.get('status') not in ('completed','incomplete'): raise RunError('The OpenAI response did not complete.')
    limited = data.get('incomplete_details',{}).get('reason') == 'max_output_tokens' if data.get('incomplete_details') else False
    if data.get('status') == 'incomplete' and not limited: raise RunError('The OpenAI response was incomplete.')
    return {'content':[{'type':'text','text':block.get('text') or block.get('refusal','')} for item in data.get('output',[]) if item.get('type')=='message' for block in item.get('content',[]) if block.get('type') in ('output_text','refusal')],
        'usage':data.get('usage',{}),'stop_reason':'max_tokens' if limited else 'end_turn'}


def as_text(value):
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)


def media_path(value):
    value = str(value)
    if value.startswith('file:'):
        parts = urlsplit(value)
        if parts.netloc not in ('', 'localhost'):
            raise RunError('Use a local media path or an HTTPS URL, not a network file URL.')
        return Path(url2pathname(parts.path))
    return Path(value).expanduser()


def secret(name):
    env_name = 'PROMPTFLOW_SECRET_' + name.upper()
    if not os.environ.get(env_name):
        raise RunError(f'Missing secret: set {env_name} before running.')
    return os.environ[env_name]


def safe_path(root, relative):
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise RunError('Bundle contains a path outside its folder.')
    return path


def resolve(value, scope, root):
    if isinstance(value, list):
        return [resolve(v, scope, root) for v in value]
    if isinstance(value, dict):
        return {k: resolve(v, scope, root) for k, v in value.items()}
    if not isinstance(value, str):
        return value
    if value.startswith('__RESOURCE_REF__:'):
        return safe_path(root, value.split(':', 1)[1]).read_text('utf-8')
    if value.startswith('__PROMPT_REF__:'):
        value = safe_path(root, 'prompts/' + value.split(':', 1)[1] + '.txt').read_text('utf-8')
    value = re.sub(r'__SECRET_REF__:([A-Za-z_][A-Za-z0-9_]*)', lambda m: secret(m[1]), value)
    value = re.sub(r'\{\{\s*secret\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}', lambda m: secret(m[1]), value)
    for key in ('USER_TEXT', 'INPUT_IMAGE_URL', 'INPUT_VIDEO_URL', 'UPLOADED_AUDIO_URL'):
        if '<' + key + '>' in value:
            value = value.replace('<' + key + '>', as_text(lookup(scope, key)))
    match = re.fullmatch(r'\{\{\s*([^}]+)\s*\}\}', value)
    if match:
        return lookup(scope, match[1].strip())
    return re.sub(r'\{\{([^}]+)\}\}', lambda m: as_text(lookup(scope, m[1].strip())), value)


def parse_json_text(text):
    text = re.sub(r'^```(?:json)?\s*|\s*```$', '', text.strip())
    try:
        return json.loads(text)
    except ValueError:
        raise RunError('The AI step returned invalid JSON. No later steps were run.') from None


class Runtime:
    def __init__(self, root, output, model=None, depth=0, max_output_tokens=4096, override_step_limits=False):
        self.root, self.output, self.model, self.depth = Path(root), Path(output), model, depth
        self.manifest = json.loads((self.root / 'manifest.json').read_text('utf-8'))
        if self.manifest.get('format') != 'promptflow/1' or not isinstance(self.manifest.get('steps'), list):
            raise RunError('This export has no executable step graph. Download it again from the updated app.')
        self.custom = {r['id']: r for r in self.manifest.get('custom_recipes', [])}
        self.max_output_tokens = max_output_tokens
        self.override_step_limits = override_step_limits

    def preflight(self):
        needs = set()
        requirements = self.root / 'requirements.txt'
        if requirements.is_file():
            missing_packages = []
            for line in requirements.read_text('utf-8').splitlines():
                match = re.match(r'^\s*([A-Za-z0-9][A-Za-z0-9_.-]*)', line)
                if not match: continue
                try: importlib.metadata.distribution(match[1])
                except importlib.metadata.PackageNotFoundError: missing_packages.append(match[1])
            if missing_packages:
                raise RunError('Missing Python packages: ' + ', '.join(missing_packages) + '. Extract the bundle and run python -m pip install -r requirements.txt with this interpreter, then retry.')
        def walk(steps):
            for step in steps:
                kind, recipe = step.get('type'), step.get('recipe_id', '')
                if kind == 'claude': needs.add(text_key(self.model or step.get('text_model') or step.get('model') or self.manifest.get('default_text_model') or 'claude-sonnet-5-5'))
                elif kind == 'loop': walk(step.get('body', []))
                elif kind == 'process':
                    if self.depth >= 6: raise RunError('Nested process depth exceeds 6.')
                    child = self.child(step)
                    child.preflight()
                elif kind == 'recipe':
                    if recipe in self.custom:
                        safe_path(self.root, self.custom[recipe]['module']).read_text('utf-8')
                    elif recipe.startswith('brave_') and recipe.endswith('_search'): needs.add('BRAVE_API_KEY')
                    elif recipe == 'gpt_image_2': needs.add('OPENAI_API_KEY')
                    elif recipe in ('assemble_document', 'assemble_website', 'assemble_files', '__promptflow_value'): pass
                    elif step.get('endpoint') or '/' in step.get('model', ''):
                        needs.add('FAL_KEY')
                        if importlib.util.find_spec('fal_client') is None:
                            raise RunError('This process uses fal media. Install its dependency: python -m pip install fal-client')
                    else: raise RunError(f'No local implementation is bundled for recipe {recipe or step.get("model")}. Download a fresh export.')
                else: raise RunError(f'Unsupported step type: {kind}')
        walk(self.manifest['steps'])
        needs.update(s.get('env_var') or ('PROMPTFLOW_SECRET_' + s['name'].upper()) for s in self.manifest.get('secrets_required', []))
        missing = sorted(key for key in needs if not os.environ.get(key))
        if missing: raise RunError('Missing API keys or secrets: ' + ', '.join(missing) + '. Set these environment variables and run again.')

    def child(self, step):
        rel = self.manifest.get('processes', {}).get(step.get('process_id'))
        if not rel: raise RunError('A nested process is missing from this export. Download the process again.')
        return Runtime(safe_path(self.root, rel), self.output, self.model, self.depth + 1, self.max_output_tokens, self.override_step_limits)

    def input_scope(self, inputs, validate=True):
        scope = dict(inputs)
        scope['user_text'] = inputs.get('text', inputs.get('user_text', ''))
        scope['USER_TEXT'] = scope['user_text']
        for name, alias in [('image','INPUT_IMAGE_URL'), ('video','INPUT_VIDEO_URL'), ('audio','UPLOADED_AUDIO_URL')]:
            value = inputs.get(name) or inputs.get(name + '_url') or inputs.get(alias)
            if value:
                if not str(value).startswith(('https://','http://','data:')) and not media_path(value).is_file():
                    raise RunError(f'The {name} input file does not exist. Use an existing path or an HTTPS URL.')
                scope[name] = scope[name + '_url'] = scope[alias] = value
        for kind in self.manifest.get('input_kinds', []) if validate else []:
            if kind == 'text' and not scope['user_text']:
                raise RunError('This process needs text. Add --text "your text" or --input text=@input.txt.')
            if kind in ('image','audio','video') and not scope.get(kind) and not scope.get(kind + '_url'):
                raise RunError(f'This process needs {kind}. Add --input {kind}=path-or-url.')
        return scope

    def plan_inputs(self, inputs, instructions, name=None):
        """Plan input preparation with the same executable tools as the runner."""
        key = text_key(self.model or self.manifest.get('default_text_model') or 'claude-sonnet-5-5')
        if not os.environ.get(key): raise RunError('Input preparation needs ' + key + '.')
        tools = ['assemble_document']
        if os.environ.get('BRAVE_API_KEY'): tools += ['brave_web_search', 'brave_news_search', 'brave_image_search']
        if os.environ.get('OPENAI_API_KEY'): tools += ['gpt_image_2']
        media = []
        def catalog(steps):
            for step in steps:
                if step.get('endpoint') or '/' in step.get('model', ''):
                    media.append({k:step[k] for k in ('recipe_id','endpoint','model') if k in step})
                catalog(step.get('body', []))
        catalog(self.manifest['steps'])
        system = (
            'Plan inputs for a saved workflow. Return JSON only: '
            '{"name":"short descriptive run name","steps":[],"inputs_map":{"text":"{{step.text}}"}}. '
            'You may also return {"error":"one specific missing detail or unavailable capability"}. '
            'Do not execute or redesign the saved workflow. Only prepare inputs requested by the user. '
            'Steps: {id,type:"claude",system_prompt,user_prompt,output_format:"text"|"json"} or '
            '{id,type:"recipe",recipe_id,params}. Templates support {{user_text}}, {{step.text}}, '
            '{{step.parsed.field}}, {{step.image_url}}. Maximum 12 preparation steps. '
            'Search params: {query,count:5}; image params: {prompt,size:"1024x1024",quality:"low"}. '
            'Use actual search tools when facts must be researched; preserve URLs. Label synthetic data synthetic. '
            'Never invent retrieved evidence or URLs. Use only available tools listed in the request. '
            'Inputs_map keys are text, image, video, audio. Map generated data, not the instruction itself. '
            'If no generation is needed, use empty steps and map the supplied inputs. '
            'No code execution, secrets, or new external endpoints.'
        )
        with activity('Planning input preparation (one provider call; no workflow steps started)'):
            data = text_request({
                'model':self.model or self.manifest.get('default_text_model') or 'claude-sonnet-5-5',
                'max_tokens':self.max_output_tokens, 'system':system,
                'messages':[{'role':'user','content':json.dumps({
                    'workflow':self.manifest.get('name'), 'description':self.manifest.get('description'),
                    'required_inputs':self.manifest.get('input_kinds',[]), 'instructions':instructions,
                    'supplied_inputs':inputs, 'available_tools':tools, 'available_media':media if os.environ.get('FAL_KEY') else [],
                })}]})
        if data.get('stop_reason') == 'max_tokens': raise RunError('Input-preparation plan reached its output limit. Increase --max-output-tokens or simplify the request.')
        plan = parse_json_text(''.join(b.get('text','') for b in data.get('content',[]) if b.get('type')=='text'))
        if not isinstance(plan,dict): raise RunError('Invalid input-preparation plan.')
        if plan.get('error'): raise RunError(str(plan['error'])[:400])
        steps, mapping = plan.get('steps'), plan.get('inputs_map')
        if not isinstance(steps,list) or len(steps)>12 or not isinstance(mapping,dict) or not mapping:
            raise RunError('Invalid input-preparation steps or input mapping.')
        ids = set()
        for step in steps:
            if not isinstance(step,dict) or step.get('type') not in ('claude','recipe') or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,79}',str(step.get('id',''))) or step['id'] in ids:
                raise RunError('Invalid or duplicate input-preparation step.')
            ids.add(step['id'])
            if step['type']=='recipe':
                allowed_media = [m for m in media if os.environ.get('FAL_KEY') and all(step.get(k)==v for k,v in m.items())]
                if step.get('recipe_id') not in tools and not allowed_media: raise RunError('Input preparation requested an unavailable tool.')
            # The model cannot replace the chosen model or output cap.
            if step['type']=='claude': step.pop('model',None)
            step.pop('text_model',None)
            step.pop('max_tokens',None)
        if any(k not in ('text','user_text','image','image_url','video','video_url','audio','audio_url') for k in mapping):
            raise RunError('Input preparation returned unsupported input names.')
        plan['name'] = str(name or plan.get('name') or 'Prepared workflow run')[:160]
        return plan

    def prepare_inputs(self, inputs, plan):
        scope = self.input_scope(inputs, validate=False)
        progress('Preparing inputs for ' + plan['name'])
        self.steps(plan['steps'], scope)
        prepared = resolve(plan['inputs_map'], scope, self.root)
        self.input_scope(prepared)  # Refuse an incomplete mapping before the workflow runs.
        return prepared

    def execute(self, inputs):
        return self.steps(self.manifest['steps'], self.input_scope(inputs))

    def steps(self, steps, scope):
        outputs = {}
        validate_parallel_groups(steps, self.root)
        i = 0
        while i < len(steps):
            step = steps[i]
            if step.get('parallel_group'):
                end = i
                while end < len(steps) and steps[end].get('parallel_group') == step['parallel_group']: end += 1
                members = steps[i:end]
                progress(f"Running {len(members)} independent steps in parallel (up to 3 at a time)")
                failed = threading.Event()
                def run_member(member):
                    if failed.is_set(): return None
                    isolated = dict(member)
                    isolated.pop('parallel_group', None)
                    try: return self.steps([isolated], dict(scope))[member['id']]
                    except BaseException:
                        failed.set()
                        raise
                with ThreadPoolExecutor(max_workers=3) as pool:
                    futures = [pool.submit(run_member, member) for member in members]
                    results = [future.result() for future in futures]
                for member, result in zip(members, results):
                    scope[member['id']] = result
                    outputs[member['id']] = result
                i = end
                continue
            scope.update(step.get('loop_scope', {}))
            sid = step.get('id') or f'step_{i}'
            kind = step['type']
            label = {'claude':'Analyzing inputs and composing a response', 'loop':'Processing each item',
                     'process':'Running a nested process', 'recipe':'Running a tool'}.get(kind, kind)
            if kind == 'recipe':
                rid = step.get('recipe_id', '')
                if rid.startswith('brave_'): label = 'Searching for relevant sources'
                elif rid == 'assemble_document': label = 'Assembling the document'
                elif rid == 'gpt_image_2' or step.get('endpoint'): label = 'Generating media'
            with activity(f'Step {i+1}/{len(steps)} · {sid}: {label}'):
                if kind == 'loop':
                    items = resolve('{{' + step['iterate_over'].strip('{} ') + '}}', scope, self.root)
                    if isinstance(items, str): items = parse_json_text(items)
                    if not isinstance(items, list): raise RunError(f'Loop {sid} requires a list.')
                    limit = min(50, max(1, int(step.get('max_iterations',50))))
                    if len(items) > limit: raise RunError(f'Loop {sid} has {len(items)} items; its limit is {limit}. Split the input before running.')
                    result = []
                    for index, item in enumerate(items):
                        progress(f'{sid}: item {index+1}/{len(items)}')
                        iteration = self.steps(step.get('body', []), {**scope, step.get('as') or 'item': item, 'index': index})
                        result.append({name:iteration.get(sid) for name,sid in step['loop_outputs'].items()} if step.get('loop_outputs') else iteration)
                elif kind == 'process':
                    mapped = resolve(step.get('inputs_map', {}), scope, self.root)
                    if 'user_text' in mapped and 'text' not in mapped: mapped['text'] = mapped['user_text']
                    result = self.child(step).execute({**scope, **mapped})
                    # Match the platform's convenient last-output aliases.
                    if result:
                        last = next(reversed(result.values()))
                        if isinstance(last, dict): result = {**result, **last}
                elif kind == 'claude': result = self.claude(step, scope)
                else: result = self.recipe(step, scope)
            scope[sid] = result
            outputs[sid] = result
            progress(f'{sid}: complete')
            i += 1
        return outputs

    def claude(self, step, scope):
        prompt = as_text(resolve(step.get('user_prompt') or '{{user_text}}', scope, self.root))
        content = [{'type':'text', 'text':prompt}]
        # Vision steps can use a supplied image, just as they do in the web runner.
        image = scope.get('image') or scope.get('INPUT_IMAGE_URL')
        if image:
            if str(image).startswith(('https://','http://')):
                source = {'type':'url', 'url':str(image)}
            else:
                path = media_path(image)
                source = {'type':'base64','media_type':mimetypes.guess_type(path.name)[0] or 'image/png','data':base64.b64encode(path.read_bytes()).decode()}
            content.insert(0, {'type':'image', 'source':source})
        model = self.model or step.get('text_model') or step.get('model') or self.manifest.get('default_text_model') or 'claude-sonnet-5-5'
        data = text_request({
            'model':model, 'max_tokens':self.max_output_tokens if self.override_step_limits else min(int(step.get('max_tokens',self.max_output_tokens)),self.max_output_tokens),
            'system':as_text(resolve(step.get('system_prompt',''),scope,self.root)),
            'messages':[{'role':'user','content':content}]})
        if data.get('stop_reason') == 'max_tokens': raise RunError('AI output reached its token limit. Increase max_tokens in the step before retrying.')
        text = ''.join(b.get('text','') for b in data.get('content',[]) if b.get('type') == 'text')
        if not text: raise RunError('The AI provider returned no text output.')
        return {'text':text, **({'parsed':parse_json_text(text)} if step.get('output_format') == 'json' else {})}

    def recipe(self, step, scope):
        rid = step.get('recipe_id','')
        params = resolve(step.get('params',{}), scope, self.root)
        if rid == '__promptflow_value': return params.get('value')
        if rid in self.custom:
            path = safe_path(self.root, self.custom[rid]['module'])
            spec = importlib.util.spec_from_file_location('pf_recipe_' + re.sub(r'\W','_',rid), path)
            module = importlib.util.module_from_spec(spec)
            sys.path.insert(0, str(self.root))
            try:
                spec.loader.exec_module(module)
                if not callable(getattr(module,'run',None)): raise RunError(f'Recipe {rid} has no run(params, scope) function.')
                return module.run(params, dict(scope))
            finally: sys.path.pop(0)
        if rid.startswith('brave_') and rid.endswith('_search'):
            endpoint = {'brave_web_search':'web','brave_news_search':'news','brave_image_search':'images'}.get(rid)
            if not endpoint: raise RunError('Unknown Brave search recipe.')
            query = params.get('query',params.get('q',scope.get('user_text','')))
            query = ' '.join(as_text(query).split()[:50])[:380].strip()
            if not query: raise RunError('Search needs a non-empty query.')
            count = max(1,min(int(params.get('count') or 10),200 if endpoint == 'images' else 20))
            data = request_json('https://api.search.brave.com/res/v1/' + endpoint + '/search?' + urlencode({'q':query,'count':count}), {'Accept':'application/json','X-Subscription-Token':os.environ['BRAVE_API_KEY']})
            rows = data.get('web',{}).get('results',[]) if endpoint == 'web' else data.get('results',[])
            if endpoint == 'images':
                rows = [{**r, 'image_url':r.get('properties',{}).get('url') or r.get('thumbnail',{}).get('src',''),
                         'thumbnail_url':r.get('thumbnail',{}).get('src',''), 'source_page_url':r.get('url',''),
                         'width':r.get('properties',{}).get('width'), 'height':r.get('properties',{}).get('height')} for r in rows]
            text = '\n\n'.join(as_text(r.get('title','')) + '\n' + as_text(r.get('image_url',r.get('url',''))) + '\n' + as_text(r.get('description','')) for r in rows)
            return {'results':rows, 'query':query, 'text':text or f'No results for "{query}".'}
        if rid == 'assemble_files':
            files=params.get('files',[])
            if not isinstance(files,list) or not 1<=len(files)<=16: raise RunError('A file pack needs 1–16 files.')
            entries={}
            for file in files:
                name=str(file.get('name',''))
                if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]*\.(md|txt|csv|json)',name) or name in entries: raise RunError('Invalid or duplicate export filename.')
                if name.endswith('.csv'):
                    records=file.get('records');columns=file.get('columns')
                    if not isinstance(records,list) or len(records)>1000 or not isinstance(columns,list) or not 1<=len(columns)<=32: raise RunError('CSV exports require records and named columns.')
                    def cell(v):
                        s='' if v is None else json.dumps(v,ensure_ascii=False) if isinstance(v,(dict,list)) else str(v)
                        return "'"+s if re.match(r'^\s*[=+@-]',s) else s
                    buffer=io.StringIO();writer=csv.writer(buffer,quoting=csv.QUOTE_ALL)
                    writer.writerow([cell(x) for x in columns]);writer.writerows([[cell(row.get(k)) for k in columns] for row in records]);content=buffer.getvalue()
                elif name.endswith('.json'): content=json.dumps(file.get('data',{}),indent=2,ensure_ascii=False)
                else: content=str(file.get('text',''))
                if not content.strip() or len(content)>150000: raise RunError('An export is empty or exceeds its size limit: '+name)
                entries[name]=content
            if sum(map(len,entries.values()))>600000: raise RunError('The export exceeds its total size limit.')
            data=io.BytesIO()
            with zipfile.ZipFile(data,'w',zipfile.ZIP_DEFLATED) as archive:
                for name,content in entries.items(): archive.writestr(name,content)
            path=self.artifact(step['id'],'.zip',data.getvalue())
            body='<!doctype html><meta charset="utf-8"><title>Workflow files</title><style>body{max-width:850px;margin:3em auto;font:16px/1.6 system-ui}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>'+html.escape(str(params.get('title','Workflow files')))+'</h1>'+''.join('<h2>'+html.escape(name)+'</h2><pre>'+html.escape(content)+'</pre>' for name,content in entries.items())
            preview=self.artifact(step['id'],'.html',body.encode('utf-8'))
            return {'html_url':preview.as_uri(),'download_url':path.as_uri(),'download_name':'workflow-files.zip','download_label':'Download files (.zip)','path':str(path)}
        if rid == 'assemble_website':
            source = re.sub(r'^```(?:html)?\s*|\s*```$', '', str(params.get('html', '')), flags=re.I)
            if len(source) < 100 or len(source) > 300000 or not re.search(r'<html[\s>]',source,re.I) or not re.search(r'<head[\s>]',source,re.I):
                raise RunError('The generated page is incomplete. Expected a complete HTML document.')
            image = str(params.get('image_url',''))
            if not image.startswith('data:image/'):
                if image.startswith('https://'):
                    with urlopen(image, timeout=60) as response:
                        data = response.read(15*1024*1024+1)
                    if len(data) > 15*1024*1024: raise RunError('Image exceeds the packaging limit.')
                    image = 'data:image/png;base64,' + base64.b64encode(data).decode()
                else:
                    path = media_path(image)
                    image = 'data:' + (mimetypes.guess_type(path.name)[0] or 'image/png') + ';base64,' + base64.b64encode(path.read_bytes()).decode()
            if not re.fullmatch(r'data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+', image): raise RunError('A generated image is required to package this page offline.')
            source = source.replace('__HERO_IMAGE__', image)
            policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
            source = re.sub(r'<head([^>]*)>', lambda m: m.group(0)+'<meta http-equiv="Content-Security-Policy" content="'+policy+'"><meta name="referrer" content="no-referrer">',source,count=1,flags=re.I)
            path = self.artifact(step['id'], '.html', source.encode('utf-8'))
            return {'html_url':path.as_uri(),'download_url':path.as_uri(),'path':str(path),'web_app':True}
        if rid == 'assemble_document':
            sections = params.get('sections') or [{'body':params.get('body',params.get('text',''))}]
            if isinstance(sections,str): sections = parse_json_text(sections)
            body = '<!doctype html><meta charset="utf-8"><title>' + html.escape(str(params.get('title','Document'))) + '</title><style>body{max-width:850px;margin:3em auto;font:16px/1.6 system-ui}img{max-width:100%}p{white-space:pre-wrap}</style><h1>' + html.escape(str(params.get('title','Document'))) + '</h1>'
            for section in sections:
                body += '<h2>' + html.escape(str(section.get('heading',''))) + '</h2><p>' + html.escape(str(section.get('body',''))) + '</p>'
                if section.get('image_url'): body += '<img src="' + html.escape(str(section['image_url']),quote=True) + '">'
            path = self.artifact(step['id'], '.html', body.encode('utf-8'))
            return {'html_url':path.as_uri(), 'html':body, 'path':str(path)}
        if rid == 'gpt_image_2':
            images = list(params.get('image_urls') or ([params['image_url']] if params.get('image_url') else []))
            if params.get('reference_asset'):
                if not images: raise RunError('Upload a source image before running the 180° conversion.')
                images.append(str(safe_path(self.root, params['reference_asset'])))
            def image_reference(value):
                value = str(value)
                if value.startswith(('https://','data:image/')): return {'image_url':value}
                path = media_path(value)
                if not path.is_file(): raise RunError('Image input does not exist: ' + value)
                mime = mimetypes.guess_type(path.name)[0]
                if mime not in ('image/png','image/jpeg','image/webp'): raise RunError('Use PNG, JPEG or WebP image inputs.')
                if path.stat().st_size > 14 * 1024 * 1024: raise RunError('Image input is too large. Use a file smaller than 14 MB.')
                return {'image_url':'data:' + mime + ';base64,' + base64.b64encode(path.read_bytes()).decode()}
            if len(images) > 16: raise RunError('Image edits accept at most 16 image inputs.')
            payload = {
                'model':params.get('model','gpt-image-2.6-sunburst'), 'prompt':params.get('prompt') or params.get('visual_prompt') or params.get('query'), 'n':1,
                'size':params.get('size','1024x1024'), 'quality':params.get('quality','medium'), 'complexity':params.get('complexity','high')}
            if images: payload.update(images=[image_reference(value) for value in images],output_format='png')
            data = request_json('https://api.openai.com/v1/images/' + ('edits' if images else 'generations'), {'Authorization':'Bearer ' + os.environ['OPENAI_API_KEY'],'Content-Type':'application/json'}, payload)
            item = data['data'][0]
            if item.get('b64_json'):
                path = self.artifact(step['id'],'.png',base64.b64decode(item['b64_json']))
                return {'image_url':path.as_uri(), 'path':str(path)}
            return {'image_url':item['url']}
        import fal_client
        endpoint = step.get('endpoint') or step.get('model')
        arguments = resolve(step.get('fal_arguments',params), scope, self.root)
        model = step.get('model','')
        if 'duration' in arguments:
            duration = float(arguments['duration'].rstrip('s')) if isinstance(arguments['duration'],str) else float(arguments['duration'])
            choices = [6,8,10] if model.startswith('ltx_') else [4,6,8] if model.startswith('veo3_') else [5,10] if model.startswith('kling_') else [6,10] if model.startswith('hailuo_') else [5,10,15] if model.startswith('wan_') else None
            if choices: duration = min(choices,key=lambda n:abs(n-duration))
            elif model.startswith('seedance_'): duration = max(4,min(15,round(duration)))
            arguments['duration'] = (str(int(duration))+'s') if model.startswith('veo3_') else str(int(duration)) if model.startswith(('seedance_','kling_','wan_')) else int(duration)
        if model.startswith('hailuo_') and arguments.get('resolution'): arguments['resolution'] = arguments['resolution'].upper()
        # Local media is uploaded only when an actual fal step consumes it.
        def upload(v):
            if isinstance(v,list): return [upload(x) for x in v]
            if isinstance(v,dict): return {k:upload(x) for k,x in v.items()}
            if isinstance(v,str) and not v.startswith(('https://','http://','data:')) and len(v) < 1024:
                try:
                    path = media_path(v)
                    if path.is_file(): return fal_client.upload_file(str(path))
                except OSError: pass
            return v
        data = fal_client.subscribe(endpoint, arguments=upload(arguments), with_logs=False)
        out = {'raw':data}
        for media in ('video','audio','image','mesh','model_mesh','model_glb'):
            if isinstance(data.get(media),dict) and data[media].get('url'): out[media + '_url'] = data[media]['url']
        if data.get('images'): out['image_url'] = data['images'][0]['url']; out['images'] = data['images']
        if data.get('url'): out['url'] = data['url']
        if 'url' not in out:
            for key in ('video_url','image_url','audio_url','model_glb_url','model_mesh_url','mesh_url'):
                if out.get(key): out['url'] = out[key]; break
        return out

    def artifact(self, name, suffix, data):
        self.output.mkdir(parents=True, exist_ok=True)
        # No clobbering of previous run artifacts, including loop iterations.
        with tempfile.NamedTemporaryFile(prefix=re.sub(r'\W','_',name)+'-', suffix=suffix, dir=self.output, delete=False) as file:
            file.write(data)
            return Path(file.name).resolve()


@contextmanager
def bundle_root(bundle):
    bundle = Path(bundle).expanduser().resolve()
    if bundle.is_dir():
        yield bundle
        return
    if not bundle.is_file() or not zipfile.is_zipfile(bundle):
        raise RunError('Expected a downloaded .promptflow ZIP or an extracted bundle folder.')
    with zipfile.ZipFile(bundle) as archive, tempfile.TemporaryDirectory(prefix='promptflow-') as tmp:
        root = Path(tmp)
        if sum(info.file_size for info in archive.infolist()) > 100 * 1024 * 1024:
            raise RunError('Bundle exceeds the 100 MB extracted size limit.')
        for info in archive.infolist():
            target = safe_path(root, info.filename)
            if info.is_dir(): continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(info))
        yield root


def main(bundle=None, argv=None):
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'): stream.reconfigure(encoding='utf-8', errors='replace')
    parser = argparse.ArgumentParser(description='Run a downloaded PromptFlow bundle with your own provider keys.')
    if bundle is None: parser.add_argument('bundle')
    parser.add_argument('--text', '-t')
    parser.add_argument('--input','-i', action='append',default=[],metavar='NAME=VALUE')
    parser.add_argument('--output-dir', default='promptflow-output')
    parser.add_argument('--model', help='Override the text model for AI steps')
    parser.add_argument('--instructions', help='Generate or research inputs before running the saved workflow')
    parser.add_argument('--name', help='Name this run')
    parser.add_argument('--max-output-tokens', type=int, default=4096, help='AI output-token limit per call (256–128000)')
    parser.add_argument('--override-step-limits', action='store_true', help='Use the selected token allowance instead of saved step limits')
    parser.add_argument('--yes', action='store_true', help='Accept the generated input-preparation plan without prompting')
    parser.add_argument('--check', action='store_true',help='Check inputs, keys, and dependencies without calling providers')
    args = parser.parse_args(argv)
    try:
        inputs = {}
        for item in args.input:
            if '=' not in item: raise RunError('Inputs must be NAME=VALUE, for example --input text=@input.txt.')
            key,value = item.split('=',1)
            if value.startswith('@') and key in ('text','user_text'): value = Path(value[1:]).read_text('utf-8')
            elif value.startswith('@'): value = str(Path(value[1:]).resolve())
            inputs[key] = value
        if args.text is not None: inputs['text'] = args.text
        with bundle_root(bundle or args.bundle) as root:
            if not 256 <= args.max_output_tokens <= 128000: raise RunError('--max-output-tokens must be between 256 and 128000.')
            runtime = Runtime(root, args.output_dir, args.model or os.environ.get('PROMPTFLOW_TEXT_MODEL'), max_output_tokens=args.max_output_tokens, override_step_limits=args.override_step_limits)
            progress('Checking bundle, required credentials, and dependencies')
            runtime.input_scope(inputs, validate=not bool(args.instructions))
            runtime.preflight()
            if args.check:
                progress('Checks passed. No provider calls were made.' + (' Generated inputs will be checked after preparation.' if args.instructions else ''))
                return 0
            progress('Running locally with your provider keys; provider charges may apply.')
            if args.instructions:
                plan = runtime.plan_inputs(inputs, args.instructions, args.name)
                progress('Run: ' + plan['name'])
                progress('Preparation: ' + ' → '.join(s.get('recipe_id') or s['id'] for s in plan['steps']))
                plan_path = runtime.artifact('preparation-plan','.json',json.dumps(plan,ensure_ascii=False,indent=2).encode('utf-8'))
                progress('Review the preparation plan: ' + str(plan_path))
                if not args.yes and input('Prepare inputs and run with provider billing? [y/N] ').strip().lower() not in ('y','yes'):
                    progress('Cancelled. Only the preparation-planning call was made.'); return 0
                inputs = runtime.prepare_inputs(inputs, plan)
            elif args.name: progress('Run: ' + args.name)
            outputs = runtime.execute(inputs)
            # Remove secret values even if a custom tool accidentally returns them.
            rendered = json.dumps(outputs,ensure_ascii=False,indent=2,default=str)
            for name,value in os.environ.items():
                if value and (name.startswith('PROMPTFLOW_SECRET_') or name in ('ANTHROPIC_API_KEY','BRAVE_API_KEY','FAL_KEY','OPENAI_API_KEY')):
                    rendered = rendered.replace(json.dumps(value,ensure_ascii=False)[1:-1],'[redacted]')
            path = runtime.artifact('result','.json',rendered.encode('utf-8'))
            print(rendered,flush=True)
            progress('Complete. Results saved to ' + str(path))
            return 0
    except KeyboardInterrupt:
        progress('Stopped. A provider request already submitted may still complete and incur a charge.')
        return 130
    except (RunError, OSError, ValueError, KeyError, ImportError) as exc:
        # Never print a resolved graph or provider exception body with credentials.
        message = str(exc) if isinstance(exc,RunError) else f'{type(exc).__name__}: check the bundle files, inputs, and requirements.txt.'
        progress('Failed: ' + message)
        return 1
    except Exception:
        progress('Failed: the tool or provider could not complete this step. Check its inputs and provider status; no later steps were run.')
        return 1


if __name__ == '__main__':
    sys.exit(main())
