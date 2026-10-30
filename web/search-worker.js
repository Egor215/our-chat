let rows=[];
const normalize=s=>s.toLocaleLowerCase('ru').replaceAll('ё','е');
self.onmessage=({data})=>{
 if(data.type==='init'){rows=data.rows.map(r=>[normalize(r[3]),r[2],r[5]]);return;}
 const q=normalize(data.query.trim()),out=[];
 if(q)for(let i=0;i<rows.length;i++){const r=rows[i];if(!r[2]&&(data.sender==='all'||r[1]===Number(data.sender))&&r[0].includes(q))out.push(i);}
 self.postMessage({seq:data.seq,results:out});
};
