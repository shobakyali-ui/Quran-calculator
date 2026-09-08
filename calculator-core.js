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
  const ayahMarkerIndex = new Map();
  const ayahStartGL = new Map();

  for(let i=0;i<markers.length;i++){
    const m=markers[i];
    if(m[1]===0){
      const key=`${m[2]}:${m[3]}`;
      ayahMarkerIndex.set(key,i);
      ayahStartGL.set(key,m[0]);
    }
  }

  function keyOf(s,a){ return `${s}:${a}`; }
  function surahData(id){ return surahMap.get(Number(id)); }
  function surahName(id){ const s=surahData(id); return s ? s.name : ''; }
  function surahAyahCount(id){ const s=surahData(id); return s ? s.ayahs : 0; }
  function pageLineFromGL(gl){
    return { page: Math.floor((gl-1)/LINES_PER_PAGE)+1, line: ((gl-1)%LINES_PER_PAGE)+1 };
  }

  // Build a local 604-page index from the embedded Mushaf row markers.
  // Each ayah occupies its start row through the row before the next marker.
  // If two ayahs start on the same row, both are attached to that row.
  const pages = Array.from({length:PAGE_COUNT+1}, (_,page) => page===0 ? null : ({
    page,
    lineVerseKeys: Array.from({length:LINES_PER_PAGE+1}, ()=>new Set()),
    allVerseKeys: new Set()
  }));
  const ayahPages = new Map();

  for(let i=0;i<markers.length;i++){
    const m=markers[i];
    if(m[1]!==0) continue;
    const startGL=m[0], surah=m[2], ayah=m[3], key=keyOf(surah,ayah);
    const nextGL = i+1 < markers.length ? markers[i+1][0] : PAGE_COUNT*LINES_PER_PAGE+1;
    const endGL = Math.max(startGL, nextGL-1);
    const touched = new Set();
    for(let gl=startGL; gl<=endGL && gl<=PAGE_COUNT*LINES_PER_PAGE; gl++){
      const {page,line}=pageLineFromGL(gl);
      const p=pages[page];
      p.lineVerseKeys[line].add(key);
      p.allVerseKeys.add(key);
      touched.add(page);
    }
    ayahPages.set(key,[...touched]);
  }

  function pageUnits(info, selectedAyahs){
    if(!info || info.allVerseKeys.size===0) return 0;

    // A real printed page is one unit if all Quran text on it is selected.
    let fullPage=true;
    for(const key of info.allVerseKeys){
      if(!selectedAyahs.has(key)){ fullPage=false; break; }
    }
    if(fullPage) return LINES_PER_PAGE;

    // Partial page: count Quran text rows only. Headers/basmala are not added
    // as extra lines; they are absorbed when the entire physical page is selected.
    let lines=0;
    for(let line=1; line<=LINES_PER_PAGE; line++){
      const keys=info.lineVerseKeys[line];
      let hit=false;
      for(const key of keys){
        if(selectedAyahs.has(key)){ hit=true; break; }
      }
      if(hit) lines++;
    }
    return lines;
  }

  function calculatePlanEndpoint(startSurah,startAyah,pagesRequested,dir){
    const targetUnits=Number(pagesRequested)*LINES_PER_PAGE;
    const selectedAyahs=new Set();
    const countedUnitsByPage=new Map();
    let totalUnits=0;
    let surah=Number(startSurah);
    let ayah=Number(startAyah);
    const step=dir==='down' ? -1 : 1;

    while(surah>=1 && surah<=114){
      const maxAyah=surahAyahCount(surah);
      for(let a=ayah; a<=maxAyah; a++){
        const key=keyOf(surah,a);
        selectedAyahs.add(key);
        const affectedPages=ayahPages.get(key) || [];
        for(const page of affectedPages){
          const oldUnits=countedUnitsByPage.get(page) || 0;
          const newUnits=pageUnits(pages[page],selectedAyahs);
          countedUnitsByPage.set(page,newUnits);
          totalUnits += newUnits-oldUnits;
        }
        if(totalUnits>=targetUnits){
          return {surah,ayah:a,clamped:false,units:totalUnits,targetUnits};
        }
      }
      surah += step;
      ayah = 1;
    }

    return dir==='down'
      ? {surah:1,ayah:surahAyahCount(1),clamped:true,units:totalUnits,targetUnits}
      : {surah:114,ayah:surahAyahCount(114),clamped:true,units:totalUnits,targetUnits};
  }

  function rangeUnits(startSurah,startAyah,endSurah,endAyah,dir){
    const selectedAyahs=new Set();
    const countedUnitsByPage=new Map();
    let totalUnits=0;
    let s=Number(startSurah), a=Number(startAyah);
    const step=dir==='down' ? -1 : 1;
    let guard=0;
    while(s>=1 && s<=114 && guard++<7000){
      const max=surahAyahCount(s);
      for(let x=a;x<=max;x++){
        const key=keyOf(s,x); selectedAyahs.add(key);
        for(const page of (ayahPages.get(key)||[])){
          const oldUnits=countedUnitsByPage.get(page)||0;
          const newUnits=pageUnits(pages[page],selectedAyahs);
          countedUnitsByPage.set(page,newUnits);
          totalUnits += newUnits-oldUnits;
        }
        if(s===Number(endSurah) && x===Number(endAyah)) return totalUnits;
      }
      s+=step; a=1;
    }
    return null;
  }

  // Calculate the exact inclusive monthly range between two entered points.
  // Direction is inferred automatically from the surah numbers. Within one surah
  // the reached ayah must be the same ayah or a later ayah.
  function calculateRangeSummary(startSurah,startAyah,endSurah,endAyah){
    const s1=Number(startSurah), a1=Number(startAyah), s2=Number(endSurah), a2=Number(endAyah);
    const max1=surahAyahCount(s1), max2=surahAyahCount(s2);

    if(!max1 || !Number.isInteger(a1) || a1<1 || a1>max1 ||
       !max2 || !Number.isInteger(a2) || a2<1 || a2>max2){
      return {valid:false,message:'أحد موضعي البداية أو الوصول غير صحيح.'};
    }

    if(s1===s2 && a2<a1){
      return {
        valid:false,
        message:'في السورة نفسها يجب أن تكون آية الوصول مساوية لآية البداية أو بعدها.'
      };
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

  // Validate that the requested number of pages actually exists from the
  // starting ayah to the Quran boundary in the selected direction.
  // An insufficient request must be reported as an error, never displayed
  // as a shortened/clamped test plan.
  function validatePlanRequest(startSurah,startAyah,pagesRequested,dir){
    const result=calculatePlanEndpoint(startSurah,startAyah,pagesRequested,dir);
    const shortfallUnits=result.clamped
      ? Math.max(0,result.targetUnits-result.units)
      : 0;
    return {
      ...result,
      enough:!result.clamped,
      availableUnits:result.clamped ? result.units : result.targetUnits,
      shortfallUnits
    };
  }

  global.QuranCalc={
    version:'Offline-Core-v1.2',
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
    _debug:{pages,ayahPages,ayahStartGL,keyOf}
  };
})(window);
