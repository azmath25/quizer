// Accessible two-or-more-tab keyboard behavior used in quiz author views.
// Keeps native click/tap semantics and provides the ARIA roving focus contract.
export function bindAccessibleTabs(root, selector, onSelect) {
  const tabs=[...root.querySelectorAll(selector)];
  if(!tabs.length || typeof onSelect!=="function")return;
  const select=target=>{
    for(const tab of tabs){
      const active=tab===target;
      tab.setAttribute("aria-selected",String(active));
      tab.tabIndex=active?0:-1;
    }
    onSelect(target);
  };
  for(const [index,tab] of tabs.entries()){
    tab.addEventListener("click",()=>select(tab));
    tab.addEventListener("keydown",event=>{
      let next;
      switch(event.key){
        case "ArrowRight":
        case "ArrowDown": next=(index+1)%tabs.length;break;
        case "ArrowLeft":
        case "ArrowUp": next=(index+tabs.length-1)%tabs.length;break;
        case "Home": next=0;break;
        case "End": next=tabs.length-1;break;
        default:return;
      }
      event.preventDefault();
      const choice=tabs[next];
      select(choice);
      choice.focus();
    });
  }
  select(tabs.find(x=>x.getAttribute("aria-selected")==="true")??tabs[0]);
}
