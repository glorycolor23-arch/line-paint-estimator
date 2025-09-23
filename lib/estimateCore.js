
export function computeEstimate(answers){
  const area = Number(answers?.area||120);
  const grade = String(answers?.paintGrade||'standard');
  const stories = Number(answers?.stories||2);
  const hasSeal = String(answers?.seal||'no')==='yes';
  const unit = grade==='premium'?2800:2000;
  const scaffold = stories>=2?180000:120000;
  const seal = hasSeal?60000:0;
  const total = Math.round((area*unit+scaffold+seal)/1000)*1000;
  const text = `概算見積もり：${total.toLocaleString()}円\n・外壁面積: 約${area}㎡\n・塗料グレード: ${grade==='premium'?'プレミアム':'スタンダード'}\n・階数: ${stories}階\n・シーリング補修: ${hasSeal?'あり':'なし'}`;
  return { total, text, inputs: answers };
}
