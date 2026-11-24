window.PFTeamThread=(()=>{
  function recipient(message,messages,agents){
    if(message.role==='user')return message.target||'team';
    if(message.to)return message.to;
    // Older records have no recipient. Infer only an explicit delegation event.
    const parent=messages.filter(m=>m.role==='assistant'&&m.id!==message.id&&m.created<=message.created&&(m.activity||[]).some(a=>a.text?.startsWith('Delegated to '+message.agent_name+':'))&&!messages.some(u=>u.role==='user'&&!u.delivery&&u.created>m.created&&u.created<=message.created&&['team',message.agent_id].includes(u.target||'team'))).at(-1);
    return parent?.agent_id||'user';
  }
  function visible(message,selected,messages,agents){
    if(!selected)return true;
    if(message.role==='user')return ['team',selected].includes(message.target||'team');
    return message.agent_id===selected||recipient(message,messages,agents)===selected;
  }
  const name=(id,agents)=>id==='user'?'You':id==='team'?'Whole team':agents.find(a=>a.id===id)?.name||id;
  return {recipient,visible,name};
})();
