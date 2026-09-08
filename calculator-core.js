/* Quran test-plan calculator core — synchronous, offline, deterministic. */
(function(global){
  'use strict';

  const QDATA = global.MUSHAF_QDATA;
  if(!QDATA) throw new Error('MUSHAF_QDATA is not loaded');

  const surahs = QDATA.surahs;
  const markers = QDATA.markers;
  const PAGE_COUNT = 604;
  const LINES_PER_PAGE = 15;

  const surahMap = new Map(surahs.map(s => [s[0], {id:s[0], name:s[1], ayahs:s[2]}]));
  const ayahStartGL = new Map();

  for(let i=0;i<markers.length;i++){
    const m=markers[i];
    if(m[1]===0) ayahStartGL.set(`${m[2]}:${m[3]}`,m[0]);
  }

  function keyOf(s,a){ return `${s}:${a}`; }
  function surahData(id){ return surahMap.get(Number(id)); }
  function surahName(id){ const s=surahData(id); return s ? s.name : ''; }
  function surahAyahCount(id){ const s=surahData(id); return s ? s.ayahs : 0; }
  function pageLineFromGL(gl){
    return { page: Math.floor((gl-1)/LINES_PER_PAGE)+1, line: ((gl-1)%LINES_PER_PAGE)+1 };
  }

  function emptyPage(page){
    return {
      page,
      lineVerseKeys:Array.from({length:LINES_PER_PAGE+1},()=>new Set()),
      allVerseKeys:new Set()
    };
  }

  // ---------------------------------------------------------------------------
  // Base embedded row map
  // ---------------------------------------------------------------------------
  // QDATA preserves the Quran text-row wrapping well, but its raw 15-row page
  // slicing drifts in Juz 'Amma because headings/basmala consume printed rows.
  // We first build the embedded row map, then remap pages 582–604 using the
  // VERIFIED first-ayah boundary of each real Madani Mushaf page.
  const rawPages = Array.from({length:PAGE_COUNT+1},(_,page)=>page===0?null:emptyPage(page));

  for(let i=0;i<markers.length;i++){
    const m=markers[i];
    if(m[1]!==0) continue;
    const startGL=m[0], surah=m[2], ayah=m[3], key=keyOf(surah,ayah);
    const nextGL=i+1<markers.length ? markers[i+1][0] : PAGE_COUNT*LINES_PER_PAGE+1;
    const endGL=Math.max(startGL,nextGL-1);
    for(let gl=startGL;gl<=endGL && gl<=PAGE_COUNT*LINES_PER_PAGE;gl++){
      const {page,line}=pageLineFromGL(gl);
      rawPages[page].lineVerseKeys[line].add(key);
      rawPages[page].allVerseKeys.add(key);
    }
  }

  // Flatten Quran TEXT rows only (headers/basmala are absent from these sets).
  // This keeps the exact Quran text-line wrapping from QDATA while allowing us
  // to place the rows inside the correct physical Juz 'Amma page boundaries.
  const textRows=[];
  const firstTextRowForAyah=new Map();
  for(let page=1;page<=PAGE_COUNT;page++){
    for(let line=1;line<=LINES_PER_PAGE;line++){
      const row=rawPages[page].lineVerseKeys[line];
      if(!row || row.size===0) continue;
      const copy=new Set(row);
      const rowIndex=textRows.length;
      textRows.push(copy);
      for(const key of copy){
        if(!firstTextRowForAyah.has(key)) firstTextRowForAyah.set(key,rowIndex);
      }
    }
  }

  // Real Madani 604-page starts for Juz 'Amma (pages 582–604).
  // Page 582 is An-Naba 1 and page 604 is Al-Ikhlas 1.
  const JUZ30_PAGE_STARTS=[
    [582,78,1],[583,78,31],[584,79,16],[585,80,1],[586,81,1],[587,82,1],
    [588,83,7],[589,83,35],[590,85,1],[591,86,1],[592,87,16],[593,89,1],
    [594,89,24],[595,91,1],[596,92,15],[597,95,1],[598,97,1],[599,98,8],
    [600,100,10],[601,103,1],[602,106,1],[603,109,1],[604,112,1]
  ];

  const pages=rawPages.slice();

  function rebuildJuz30Pages(){
    for(let i=0;i<JUZ30_PAGE_STARTS.length;i++){
      const [page,surah,ayah]=JUZ30_PAGE_STARTS[i];
      const startIdx=firstTextRowForAyah.get(keyOf(surah,ayah));
      const next=JUZ30_PAGE_STARTS[i+1];
      const endExclusive=next
        ? firstTextRowForAyah.get(keyOf(next[1],next[2]))
        : textRows.length;
      if(startIdx===undefined || endExclusive===undefined || endExclusive<startIdx){
        throw new Error(`تعذر بناء صفحة جزء عم ${page}`);
      }
      const info=emptyPage(page);
      const pageRows=textRows.slice(startIdx,endExclusive);
      // The physical page is always one unit (=15) when fully selected; for a
      // boundary page we only need its Quran text rows, not header/basmala rows.
      for(let j=0;j<pageRows.length && j<LINES_PER_PAGE;j++){
        info.lineVerseKeys[j+1]=new Set(pageRows[j]);
        for(const key of pageRows[j]) info.allVerseKeys.add(key);
      }
      pages[page]=info;
    }
  }
  rebuildJuz30Pages();

  // Rebuild ayah -> physical pages from the FINAL page map.
  const ayahPages=new Map();
  for(let page=1;page<=PAGE_COUNT;page++){
    const info=pages[page];
    if(!info) continue;
    for(const key of info.allVerseKeys){
      if(!ayahPages.has(key)) ayahPages.set(key,[]);
      ayahPages.get(key).push(page);
    }
  }

  function pageUnits(info,selectedAyahs){
    if(!info || info.allVerseKeys.size===0) return 0;

    // User rule: any fully covered physical Mushaf page = exactly one page,
    // regardless of how many surahs, headings, or basmalas it contains.
    let fullPage=true;
    for(const key of info.allVerseKeys){
      if(!selectedAyahs.has(key)){ fullPage=false; break; }
    }
    if(fullPage) return LINES_PER_PAGE;

    // Only START/END boundary pages use line counting. Count Quran text rows
    // touched by the selected ayahs; headings and basmala are never extra lines.
    let lines=0;
    for(let line=1;line<=LINES_PER_PAGE;line++){
      const keys=info.lineVerseKeys[line];
      let hit=false;
      for(const key of keys){
        if(selectedAyahs.has(key)){ hit=true; break; }
      }
      if(hit) lines++;
    }
    return lines;
  }

  function juz30Units(selectedAyahs,touchedJuzPages){
    if(!touchedJuzPages || touchedJuzPages.size===0) return 0;
    const nums=[...touchedJuzPages].sort((a,b)=>a-b);
    const min=nums[0], max=nums[nums.length-1];
    let total=0;
    for(const page of nums){
      // Juz 'Amma special rule agreed with the user:
      // once a physical page lies BETWEEN the start and end boundary pages,
      // it is one complete page regardless of how many surahs/headers it has
      // or whether an endpoint-surah continuation also appears on that page.
      if(page>min && page<max) total+=LINES_PER_PAGE;
      else total+=pageUnits(pages[page],selectedAyahs);
    }
    return total;
  }

  function newAccumulator(){
    return {
      selectedAyahs:new Set(),
      standardUnitsByPage:new Map(),
      standardTotal:0,
      touchedJuzPages:new Set()
    };
  }

  function addAyahToAccumulator(acc,key){
    acc.selectedAyahs.add(key);
    for(const page of (ayahPages.get(key)||[])){
      if(page>=582){
        acc.touchedJuzPages.add(page);
      }else{
        const oldUnits=acc.standardUnitsByPage.get(page)||0;
        const newUnits=pageUnits(pages[page],acc.selectedAyahs);
        acc.standardUnitsByPage.set(page,newUnits);
        acc.standardTotal+=newUnits-oldUnits;
      }
    }
    return acc.standardTotal+juz30Units(acc.selectedAyahs,acc.touchedJuzPages);
  }

  function calculatePlanEndpoint(startSurah,startAyah,pagesRequested,dir){
    const targetUnits=Number(pagesRequested)*LINES_PER_PAGE;
    const acc=newAccumulator();
    let totalUnits=0;
    let surah=Number(startSurah);
    let ayah=Number(startAyah);
    const step=dir==='down' ? -1 : 1;

    while(surah>=1 && surah<=114){
      const maxAyah=surahAyahCount(surah);
      for(let a=ayah;a<=maxAyah;a++){
        totalUnits=addAyahToAccumulator(acc,keyOf(surah,a));
        if(totalUnits>=targetUnits){
          return {surah,ayah:a,clamped:false,units:totalUnits,targetUnits};
        }
      }
      surah+=step;
      ayah=1;
    }

    return dir==='down'
      ? {surah:1,ayah:surahAyahCount(1),clamped:true,units:totalUnits,targetUnits}
      : {surah:114,ayah:surahAyahCount(114),clamped:true,units:totalUnits,targetUnits};
  }

  function rangeUnits(startSurah,startAyah,endSurah,endAyah,dir){
    const acc=newAccumulator();
    let totalUnits=0;
    let s=Number(startSurah),a=Number(startAyah);
    const step=dir==='down' ? -1 : 1;
    let guard=0;
    while(s>=1 && s<=114 && guard++<7000){
      const max=surahAyahCount(s);
      for(let x=a;x<=max;x++){
        totalUnits=addAyahToAccumulator(acc,keyOf(s,x));
        if(s===Number(endSurah) && x===Number(endAyah)) return totalUnits;
      }
      s+=step;
      a=1;
    }
    return null;
  }

  function calculateRangeSummary(startSurah,startAyah,endSurah,endAyah){
    const s1=Number(startSurah),a1=Number(startAyah),s2=Number(endSurah),a2=Number(endAyah);
    const max1=surahAyahCount(s1),max2=surahAyahCount(s2);

    if(!max1 || !Number.isInteger(a1) || a1<1 || a1>max1 ||
       !max2 || !Number.isInteger(a2) || a2<1 || a2>max2){
      return {valid:false,message:'أحد موضعي البداية أو الوصول غير صحيح.'};
    }

    if(s1===s2 && a2<a1){
      return {valid:false,message:'في السورة نفسها يجب أن تكون آية الوصول مساوية لآية البداية أو بعدها.'};
    }

    const dir=s2<s1 ? 'down' : 'up';
    const units=rangeUnits(s1,a1,s2,a2,dir);
    if(units===null){
      return {valid:false,message:'تعذر الوصول من موضع البداية إلى موضع الوصول بهذا الترتيب.'};
    }
    return {valid:true,dir,units,startSurah:s1,startAyah:a1,endSurah:s2,endAyah:a2};
  }

  function formatLines(lines){
    if(lines===1) return '1 سطر';
    if(lines===2) return 'سطران';
    if(lines>=3 && lines<=10) return `${lines} أسطر`;
    return `${lines} سطرًا`;
  }

  function formatUnits(units){
    const safeUnits=Math.max(0,Math.round(Number(units)||0));
    const whole=Math.floor(safeUnits/LINES_PER_PAGE);
    const lines=safeUnits%LINES_PER_PAGE;
    if(lines===0) return `${whole} صفحة`;
    if(whole===0) return formatLines(lines);
    return `${whole} صفحة و${formatLines(lines)}`;
  }

  function validatePlanRequest(startSurah,startAyah,pagesRequested,dir){
    const result=calculatePlanEndpoint(startSurah,startAyah,pagesRequested,dir);
    const shortfallUnits=result.clamped ? Math.max(0,result.targetUnits-result.units) : 0;
    return {
      ...result,
      enough:!result.clamped,
      availableUnits:result.clamped ? result.units : result.targetUnits,
      shortfallUnits
    };
  }

  global.QuranCalc={
    version:'Offline-Core-v1.3',
    dataVersion:global.MUSHAF_DATA_VERSION,
    surahs,
    surahName,
    surahAyahCount,
    pageLineFromGL,
    pageUnits,
    calculatePlanEndpoint,
    validatePlanRequest,
    rangeUnits,
    calculateRangeSummary,
    formatUnits,
    _debug:{pages,rawPages,ayahPages,ayahStartGL,keyOf,JUZ30_PAGE_STARTS,textRows,firstTextRowForAyah}
  };
})(window);
