"""Public activity summaries for both new and older streaming servers."""
import time

MESSAGES = {
    'reading':'Reading the request and available inputs',
    'search':'Searching for reusable processes and relevant tools',
    'retrieving':'Searching for reusable processes and relevant tools',
    'planning':'Designing the steps for this request',
    'reasoning':'Thinking through how the steps fit the request',
    'validating':'Checking step structure and dependencies',
    'saving':'Saving the process for review',
    'editing':'Considering the requested changes to the process',
}

def consume(events, console):
    from promptflow_cli.client import ApiError
    started = time.monotonic()
    stage = None
    last_heartbeat = 0
    for event,data in events:
        if event in ('stage','thinking'):
            key = 'reasoning' if event == 'thinking' else data.get('stage')
            if key in MESSAGES and key != stage:
                stage = key
                console.print('  ' + MESSAGES[key] + '…', markup=False)
        elif event == 'heartbeat' and time.monotonic() - last_heartbeat >= 10:
            console.print(f'  Still working: {MESSAGES.get(stage,"processing the request")} ({int(time.monotonic()-started)}s)', markup=False)
            last_heartbeat = time.monotonic()
        elif event == 'error' or (event == 'done' and data.get('ok') is False):
            raise ApiError(data.get('message') or 'The request failed. Check Processes before retrying.',code=data.get('error'))
        elif event == 'done':
            return data
    raise ApiError('The connection ended before completion. Check Processes for a saved draft before retrying.')
