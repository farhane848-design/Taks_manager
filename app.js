const SUPABASE_URL = "https://dbakpnpzslvvdgxychcg.supabase.co";
        const SUPABASE_KEY = "sb_publishable_V1BJXeUpyEaRqcWAIp9Kbg_vP2f1iDH";
        const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        
        let currentProjectId = null;
        let searchTimeout = null;
        let existingAttachments = []; 
        let dashboardChartInstance = null; 
        let documentsData = [];
        let notesData = [];
        let projectCache = [];
        let tasksCache = []; // Untuk Kanban dan caching lokal agar drag drop smooth

        function initTheme() {
            const theme = localStorage.getItem('taskflow-theme');
            document.documentElement.classList.toggle('dark', theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches));
        }
        function toggleTheme() {
            document.documentElement.classList.toggle('dark');
            localStorage.setItem('taskflow-theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
            if (dashboardChartInstance) loadStats();
        }

        function updateRealtimeClock() {
            const now = new Date();
            const date = new Intl.DateTimeFormat('id-ID', { weekday:'short', day:'numeric', month:'short', timeZone:'Asia/Jakarta' }).format(now);
            const time = new Intl.DateTimeFormat('id-ID', { hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23', timeZone:'Asia/Jakarta' }).format(now);
            document.getElementById('currentDate').textContent = date;
            document.getElementById('currentTime').textContent = time;
            const boardDate=document.getElementById('kanbanBoardDate');
            if(boardDate) boardDate.textContent=new Intl.DateTimeFormat('id-ID',{weekday:'long',day:'numeric',month:'long',timeZone:'Asia/Jakarta'}).format(now).toUpperCase();
        }

        document.addEventListener("DOMContentLoaded", async () => {
            initTheme();
            lucide.createIcons();
            updateRealtimeClock();
            setInterval(updateRealtimeClock, 1000);
            await refreshAll();
        });

        async function refreshAll() {
            // Fetch global data tasks sekali untuk dipakai tabel dan kanban
            const { data: tasks } = await client.from("tasks").select("*").eq("archived", false);
            if (tasks) tasksCache = tasks;

            await Promise.all([
                loadStats(),
                loadProjectDropdown(),
                renderTable(),
                loadResources()
            ]);
            renderDocuments(); renderNotes(); renderNotifications();

            if (document.getElementById("projectPage").style.display === "block") await renderProjects();
            if (document.getElementById("kanbanPage").style.display === "block") await renderKanban();
            if (document.getElementById("archivePage").style.display === "block") await renderArchive();
            if (currentProjectId && document.getElementById("projectDetailPage").style.display === "block") await openProject(currentProjectId);
        }

        async function loadStats() {
            const { data: projects } = await client.from("projects").select("*").eq("archived", false);
            const { data: tasks } = await client.from("tasks").select("*").eq("archived", false);
            const { data: archiveTasks } = await client.from("tasks").select("*").eq("archived", true);

            if (projects && tasks && archiveTasks) {
                // Update Arsip Stats
                document.getElementById("archiveTotalTask").innerText = archiveTasks.length;
                const uniqueProject = new Set(archiveTasks.map(task => task.project_id));
                document.getElementById("archiveProjectCount").innerText = uniqueProject.size;

                const today = new Date().toISOString().split("T")[0];
                
                // Kalkulasi Stats Utama
                const countPending = tasks.filter(t => t.status !== "done").length;
                const countDone = tasks.filter(t => t.status === "done").length;
                const countTodo = tasks.filter(t => t.status === "todo").length;
                const countProgress = tasks.filter(t => t.status === "progress").length;
                
                const overdueTasks = tasks.filter(t => t.status !== "done" && t.deadline < today)
                                         .sort((a,b) => new Date(a.deadline) - new Date(b.deadline));
                const countOverdue = overdueTasks.length;
                const dateInThreeDays = new Date(); dateInThreeDays.setDate(dateInThreeDays.getDate() + 3);
                const threeDays = dateInThreeDays.toISOString().split('T')[0];
                const dateTomorrow = new Date(); dateTomorrow.setDate(dateTomorrow.getDate() + 1);
                const tomorrow = dateTomorrow.toISOString().split('T')[0];
                const todayTasks = tasks.filter(t => t.status !== 'done' && t.deadline === today);
                const nearTasks = tasks.filter(t => t.status !== 'done' && t.deadline > tomorrow && t.deadline <= threeDays)
                    .sort((a,b) => new Date(a.deadline) - new Date(b.deadline));

                document.getElementById("statTotalProject").innerText = projects.length;
                document.getElementById("statTotalTask").innerText = tasks.length;
                document.getElementById("statPending").innerText = countPending;
                document.getElementById("statDone").innerText = countDone;

                updateDashboardChart(countTodo, countProgress, countDone);

                document.getElementById("statOverdueBadge").innerText = `${countOverdue} Task`;
                const overdueContainer = document.getElementById("dashboardOverdueList");
                
                if(countOverdue === 0) {
                    overdueContainer.innerHTML = `<div class="flex flex-col items-center justify-center h-full text-slate-500 py-10"><i data-lucide="smile" class="w-10 h-10 mb-3 text-slate-300"></i><p>Hebat! Tidak ada task yang terlambat.</p></div>`;
                } else {
                    let htmlList = '';
                    const maxDisplay = Math.min(5, overdueTasks.length);
                    for(let i=0; i < maxDisplay; i++) {
                        let t = overdueTasks[i];
                        let projName = projects.find(p => p.id == t.project_id)?.name || "Unknown Project";
                        const diffTime = Math.abs(new Date(today) - new Date(t.deadline));
                        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                        htmlList += `
                        <div onclick="openProject(${t.project_id})" class="cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between p-4 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                            <div><h4 class="font-bold text-slate-900 text-sm">${t.title}</h4><p class="text-xs text-slate-500 mt-1"><i data-lucide="folder" class="w-3 h-3 inline"></i> ${projName}</p></div>
                            <div class="mt-2 sm:mt-0 text-right"><span class="block text-xs font-semibold text-red-600 bg-red-50 px-2 py-1 rounded">Telat ${diffDays} Hari</span><span class="block text-[11px] text-slate-400 mt-1">Selesai: ${t.deadline}</span></div>
                        </div>`;
                    }
                    if(overdueTasks.length > 5) htmlList += `<div class="text-center p-3 text-xs text-brand-600 font-medium cursor-pointer hover:underline" onclick="showAllTasks(event)">Lihat ${overdueTasks.length - 5} task lainnya di Semua Task &rarr;</div>`;
                    overdueContainer.innerHTML = htmlList;
                }
                
                document.getElementById('statNearDeadlineBadge').innerText = `${nearTasks.length} Task`;
                document.getElementById('statTodayDeadlineBadge').innerText = `${todayTasks.length} Task`;
                document.getElementById('dashboardTodayDeadlineList').innerHTML = todayTasks.length ? todayTasks.map(t => `<div onclick="openProject(${t.project_id})" class="cursor-pointer flex items-center justify-between p-4 border-b border-slate-100 hover:bg-red-50 transition-colors"><div><h4 class="font-bold text-slate-900 text-sm">${esc(t.title)}</h4><p class="text-xs text-slate-500 mt-1"><i data-lucide="folder" class="w-3 h-3 inline"></i> ${esc(projects.find(p=>p.id==t.project_id)?.name||'Unknown')}</p></div><span class="text-xs font-semibold text-red-700 bg-red-100 px-2 py-1 rounded">Hari ini</span></div>`).join('') : '<div class="text-center p-6 text-sm text-slate-500">Tidak ada deadline hari ini.</div>';
                document.getElementById('dashboardNearDeadlineList').innerHTML = nearTasks.length ? nearTasks.map(t => `<div onclick="openProject(${t.project_id})" class="cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between p-4 border-b border-slate-100 hover:bg-amber-50 transition-colors"><div><h4 class="font-bold text-slate-900 text-sm">${esc(t.title)}</h4><p class="text-xs text-slate-500 mt-1"><i data-lucide="folder" class="w-3 h-3 inline"></i> ${esc(projects.find(p=>p.id==t.project_id)?.name||'Unknown')}</p></div><span class="mt-2 sm:mt-0 text-xs font-semibold text-amber-700 bg-amber-100 px-2 py-1 rounded">${t.deadline}</span></div>`).join('') : '<div class="text-center p-6 text-sm text-slate-500">Tidak ada deadline dalam 3 hari ke depan.</div>';
                lucide.createIcons();
            }
        }

        function updateDashboardChart(todo, progress, done) {
            const ctx = document.getElementById('taskStatusChart');
            const total = todo + progress + done;
            const percentDone = total === 0 ? 0 : Math.round((done / total) * 100);

            const textDiv = document.getElementById("chartCenterText");
            const percentageSpan = document.getElementById("chartCenterPercentage");
            if(total > 0) { textDiv.classList.remove("hidden"); percentageSpan.innerText = `${percentDone}%`; } else { textDiv.classList.add("hidden"); }

            if(dashboardChartInstance) dashboardChartInstance.destroy(); 
            dashboardChartInstance = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: ['Todo', 'Progress', 'Done'],
                    datasets: [{
                        data: total === 0 ? [1] : [todo, progress, done],
                        backgroundColor: total === 0 ? ['#f1f5f9'] : ['#fef3c7', '#dbeafe', '#22c55e'],
                        borderWidth: 0, hoverOffset: 4
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false, cutout: '75%',
                    plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, padding: 20, font: { family: "'Inter', sans-serif", size: 12 } } }, tooltip: { callbacks: { label: function(context) { if(total === 0) return ' Belum ada data'; let label = context.label || ''; if (label) label += ': '; if (context.parsed !== null) label += context.parsed + ' Task'; return label; } } } }
                }
            });
        }

        async function loadProjectDropdown() {
            const { data } = await client.from("projects").select("*").eq("archived", false).order("id");
            if (!data) return;
            let filterHtml = `<option value="">Semua Project</option>`, formHtml = "";
            data.forEach(p => { filterHtml += `<option value="${p.id}">${p.name}</option>`; formHtml += `<option value="${p.id}">${p.name}</option>`; });
            document.getElementById("filterProject").innerHTML = filterHtml;
            document.getElementById("kanbanFilterProject").innerHTML = filterHtml; // Kanban filter dropdown
            document.getElementById("taskProject").innerHTML = formHtml;
            projectCache = data;
            const resourceOptions = `<option value="">Pilih project</option>` + formHtml;
            document.getElementById("documentProject").innerHTML = resourceOptions;
            document.getElementById("noteProject").innerHTML = resourceOptions;
            const filterOptions = `<option value="">Semua Project</option>` + formHtml;
            document.getElementById("documentProjectFilter").innerHTML = filterOptions;
            document.getElementById("noteProjectFilter").innerHTML = filterOptions;
        }

        // === LOGIKA KANBAN & DRAG DROP ===
        async function renderKanban() {
            const filterProj = document.getElementById("kanbanFilterProject").value;
            let tasks = tasksCache;

            if(filterProj) tasks = tasks.filter(t => t.project_id == filterProj);
            
            const cols = { todo: document.getElementById("kanbanColTodo"), progress: document.getElementById("kanbanColProgress"), done: document.getElementById("kanbanColDone") };
            let counts = { todo: 0, progress: 0, done: 0 };
            const today = new Date().toISOString().split('T')[0];
            
            // Bersihkan kolom
            Object.values(cols).forEach(col => col.innerHTML = '');

            tasks.forEach(t => {
                if(!cols[t.status]) return; // Skip if invalid status
                counts[t.status]++;
                
                let proj = projectCache.find(p => p.id == t.project_id) || { name: 'Unknown', color: '#ccc' };
                let deadlineClass = "text-slate-500 bg-slate-100";
                let deadlineIcon = "calendar";
                
                if (t.status !== 'done') {
                    if (t.deadline < today) { deadlineClass = "text-red-600 bg-red-100"; deadlineIcon = "alert-triangle"; }
                    else if (t.deadline === today) { deadlineClass = "text-amber-600 bg-amber-100"; deadlineIcon = "clock"; }
                }

                // Checklists status
                let checklistText = '';
                if(t.subtasks && t.subtasks.length > 0) {
                    const doneCount = t.subtasks.filter(s => s.done).length;
                    checklistText = `<span class="flex items-center gap-1 text-[11px] font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded"><i data-lucide="check-square" class="w-3 h-3"></i> ${doneCount}/${t.subtasks.length}</span>`;
                }

                const mobileStatusOptions = [['todo','Todo'],['progress','In Progress'],['done','Done']].map(([value,label]) => `<option value="${value}" ${t.status===value?'selected':''}>${label}</option>`).join('');

                const cardHtml = `
                <div class="kanban-card bg-white p-4 rounded-xl shadow-sm border border-slate-200 hover:border-brand-300 hover:shadow-md transition-all dark:bg-slate-800 dark:border-slate-600" 
                     draggable="true" 
                     ondragstart="kanbanDragStart(event, ${t.id})" 
                     ondragend="kanbanDragEnd(event)"
                     onclick='editTask(${JSON.stringify(t).replace(/'/g, "&#39;")})'>
                    
                    <div class="flex justify-between items-start mb-2">
                        <span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded tracking-wide" style="color: ${proj.color}; background-color: ${proj.color}20">${proj.name}</span>
                        <div class="flex gap-2">
                            ${checklistText}
                        </div>
                    </div>
                    
                    <h4 class="font-bold text-slate-800 text-sm mb-1 leading-snug dark:text-slate-100">${t.title}</h4>
                    ${t.description ? `<p class="text-xs text-slate-500 line-clamp-2 mb-3 leading-relaxed dark:text-slate-400">${t.description}</p>` : '<div class="mb-3"></div>'}
                    
                    <div class="mt-auto flex justify-between items-center border-t border-slate-100 pt-3 dark:border-slate-700">
                        <select class="kanban-mobile-status" aria-label="Ubah status task" onclick="event.stopPropagation()" onchange="moveKanbanTask(this, ${t.id})">${mobileStatusOptions}</select>
                        <span class="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded ${deadlineClass}"><i data-lucide="${deadlineIcon}" class="w-3 h-3"></i> ${t.deadline}</span>
                        
                        <div class="flex -space-x-2">
                            <!-- Placeholder User Avatar (Kanban look) -->
                            <img class="w-6 h-6 rounded-full border-2 border-white dark:border-slate-800" src="https://ui-avatars.com/api/?name=F+E&background=random&color=fff" alt="User">
                        </div>
                    </div>
                </div>`;
                
                cols[t.status].insertAdjacentHTML('beforeend', cardHtml);
            });

            document.getElementById("kanbanCountTodo").innerText = counts.todo;
            document.getElementById("kanbanCountProgress").innerText = counts.progress;
            document.getElementById("kanbanCountDone").innerText = counts.done;
            lucide.createIcons();
        }

        // Drag & Drop Events
        function kanbanDragStart(ev, taskId) {
            ev.dataTransfer.setData("taskId", taskId);
            setTimeout(() => { ev.target.classList.add('dragging'); }, 0);
        }
        function kanbanDragEnd(ev) {
            ev.target.classList.remove('dragging');
            document.querySelectorAll('.kanban-dropzone').forEach(el => el.classList.remove('drag-over'));
        }
        function kanbanAllowDrop(ev) {
            ev.preventDefault();
        }
        function kanbanDragEnter(ev) {
            ev.preventDefault();
            const dropzone = ev.target.closest('.kanban-dropzone');
            if(dropzone) dropzone.classList.add('drag-over');
        }
        function kanbanDragLeave(ev) {
            const dropzone = ev.target.closest('.kanban-dropzone');
            if(dropzone) dropzone.classList.remove('drag-over');
        }
        async function kanbanDrop(ev, newStatus) {
            ev.preventDefault();
            document.querySelectorAll('.kanban-dropzone').forEach(el => el.classList.remove('drag-over'));
            
            const taskId = ev.dataTransfer.getData("taskId");
            if (!taskId) return;
            
            // Update local cache optimistically
            const taskIndex = tasksCache.findIndex(t => t.id == taskId);
            if (taskIndex > -1 && tasksCache[taskIndex].status !== newStatus) {
                tasksCache[taskIndex].status = newStatus;
                renderKanban(); // Re-render instan ke UI
                
                try {
                    // Simpan ke DB secara asinkron
                    await client.from("tasks").update({ status: newStatus }).eq("id", taskId);
                    showToast("Task dipindahkan", "success");
                    loadStats(); // Update dashboard charts in background
                } catch(e) {
                    showToast("Gagal memindahkan task", "danger");
                }
            }
        }

        async function moveKanbanTask(select, taskId) {
            const task=tasksCache.find(item=>String(item.id)===String(taskId));
            if(!task || task.status===select.value) return;
            const previous=task.status, next=select.value;
            task.status=next;
            renderKanban();
            const {error}=await client.from('tasks').update({status:next}).eq('id',taskId);
            if(error){task.status=previous;renderKanban();showToast('Status task gagal diperbarui','danger');return;}
            showToast('Status task diperbarui','success');
            loadStats();
        }

        const esc = (value = '') => String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
        const localRows = (name) => JSON.parse(localStorage.getItem(`taskflow-${name}`) || '[]');
        const saveLocalRows = (name, rows) => localStorage.setItem(`taskflow-${name}`, JSON.stringify(rows));
        
        async function loadResources() {
            const [docRes, noteRes] = await Promise.all([
                client.from('documents').select('*').order('created_at', {ascending:false}),
                client.from('notes').select('*').order('created_at', {ascending:false})
            ]);
            documentsData = docRes.error ? localRows('documents') : (docRes.data || []);
            notesData = noteRes.error ? localRows('notes') : (noteRes.data || []);
            renderDocuments(); renderNotes(); renderNotifications();
        }
        function projectName(id) { return projectCache.find(p => String(p.id) === String(id))?.name || 'Tanpa project'; }
        function projectColor(id) { return projectCache.find(p => String(p.id) === String(id))?.color || '#f59e0b'; }
        
        function renderDocuments() { /*... existing render logic ...*/ 
            const target = document.getElementById('documentsList'); if (!target) return;
            const filter=document.getElementById('documentProjectFilter')?.value || '', query=(document.getElementById('documentSearch')?.value || '').toLowerCase(); const rows=documentsData.filter(d=>(!filter || String(d.project_id)===filter) && `${d.name} ${d.description||''} ${projectName(d.project_id)}`.toLowerCase().includes(query));
            target.innerHTML = rows.length ? rows.map(d => `<div class="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"><div class="flex gap-3"><div class="w-10 h-10 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center shrink-0"><i data-lucide="file-text" class="w-5 h-5"></i></div><div><p class="font-semibold text-slate-800">${esc(d.name)}</p><p class="text-sm text-slate-500">${esc(d.description || 'Tanpa deskripsi')} · ${esc(projectName(d.project_id))}</p></div></div><div class="flex gap-2 items-center">${d.file_url ? `<a href="${esc(d.file_url)}" target="_blank" class="resource-action edit" title="Buka dokumen"><i data-lucide="external-link" class="w-4 h-4"></i></a>` : ''}<button onclick="editDocument(${d.id})" class="resource-action edit" title="Edit dokumen"><i data-lucide="pencil" class="w-4 h-4"></i></button><button onclick="deleteDocument(${d.id})" class="resource-action delete" title="Hapus dokumen"><i data-lucide="trash-2" class="w-4 h-4"></i></button></div></div>`).join('') : '<div class="p-12 text-center text-slate-500">Dokumen tidak ditemukan.</div>';
            lucide.createIcons();
        }
        function renderNotes() { /*... existing render logic ...*/ 
            const target = document.getElementById('notesList'); if (!target) return;
            const filter=document.getElementById('noteProjectFilter')?.value || '', query=(document.getElementById('noteSearch')?.value || '').toLowerCase(); const rows=notesData.filter(n=>(!filter || String(n.project_id)===filter) && `${n.title} ${n.content} ${projectName(n.project_id)}`.toLowerCase().includes(query));
            target.innerHTML = rows.length ? rows.map(n => { const color=projectColor(n.project_id); return `<article class="note-card rounded-2xl p-5 relative overflow-hidden" style="border-color:${color}80;box-shadow:0 8px 20px ${color}22"><i data-lucide="quote" class="absolute -right-2 -top-2 w-20 h-20 opacity-20" style="color:${color}"></i><div class="flex justify-between gap-3 relative"><div><p class="text-[11px] uppercase tracking-wider font-bold mb-2" style="color:${color}">${esc(projectName(n.project_id))}</p><h3 class="font-bold text-slate-800 text-lg">${esc(n.title)}</h3></div><div class="flex gap-2"><button onclick="editNote(${n.id})" class="resource-action edit" title="Edit catatan"><i data-lucide="pencil" class="w-4 h-4"></i></button><button onclick="deleteNote(${n.id})" class="resource-action delete" title="Hapus catatan"><i data-lucide="trash-2" class="w-4 h-4"></i></button></div></div><p class="text-sm text-slate-600 whitespace-pre-wrap mt-4 leading-6 relative">${esc(notePreview(n.content))}</p>${n.link_url ? `<a href="${esc(n.link_url)}" target="_blank" class="inline-flex items-center gap-1 text-xs font-bold mt-5 relative" style="color:${color}"><i data-lucide="link" class="w-3.5 h-3.5"></i> Buka tautan terkait</a>` : ''}</article>`; }).join('') : '<div class="col-span-full py-12 text-center text-slate-500">Catatan tidak ditemukan.</div>';
            lucide.createIcons();
        }
        function renderProjectResources(projectId) {
            const docs = documentsData.filter(d => String(d.project_id) === String(projectId));
            const notes = notesData.filter(n => String(n.project_id) === String(projectId));
            document.getElementById('projectDocumentsList').innerHTML = docs.length ? docs.map(d => `<div class="flex gap-2 items-center"><i data-lucide="file" class="w-4 h-4 text-brand-600 shrink-0"></i><span class="flex-1 truncate">${esc(d.name)}</span>${d.file_url ? `<a href="${esc(d.file_url)}" target="_blank" class="text-brand-600"><i data-lucide="external-link" class="w-3.5 h-3.5"></i></a>` : ''}<button onclick="editDocument(${d.id})" class="text-brand-600"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button><button onclick="deleteDocument(${d.id})" class="text-red-600"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button></div>`).join('') : '<p class="text-slate-500 text-xs">Belum ada dokumen.</p>';
            document.getElementById('projectNotesList').innerHTML = notes.length ? notes.map(n => `<div class="border-l-2 border-amber-400 pl-3"><div class="flex gap-2"><b class="text-slate-800 flex-1">${esc(n.title)}</b><button onclick="editNote(${n.id})" class="text-brand-600"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button><button onclick="deleteNote(${n.id})" class="text-red-600"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button></div><p class="text-slate-500 text-xs mt-1 line-clamp-3">${esc(notePreview(n.content))}</p></div>`).join('') : '<p class="text-slate-500 text-xs">Belum ada catatan.</p>';
            lucide.createIcons();
        }

        async function renderTable() {
            const tableBody = document.getElementById('taskTableBody');
            const searchQ = document.getElementById('searchInput').value.toLowerCase();
            const filterProj = document.getElementById('filterProject').value;
            const filterStat = document.getElementById('filterStatus').value;
            const sortBy = document.getElementById('sortData').value;
            
            let filteredTasks = tasksCache.filter(t => {
                const proj = projectCache.find(p => p.id == t.project_id) || {};
                const projectName = (proj.name || "").toLowerCase();
                let matchSearch = t.title.toLowerCase().includes(searchQ) || (t.description || "").toLowerCase().includes(searchQ) || projectName.includes(searchQ);
                let matchProj = filterProj ? t.project_id == filterProj : true;
                let matchStat = filterStat ? t.status == filterStat : true;
                return (matchSearch && matchProj && matchStat);
            });
            const statusOrder = { progress: 1, todo: 2, done: 3 };
            filteredTasks.sort((a, b) => {
                if (statusOrder[a.status] !== statusOrder[b.status]) return statusOrder[a.status] - statusOrder[b.status];
                if (sortBy === "deadline_asc") return new Date(a.deadline) - new Date(b.deadline);
                if (sortBy === "deadline_description") return new Date(b.deadline) - new Date(a.deadline);
                if (sortBy === "newest") return b.id - a.id;
                return 0;
            });

            if (filteredTasks.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-12 text-slate-500">Tidak ada Task ditemukan.</td></tr>`;
                return;
            }

            let html = '';
            const today = new Date().toISOString().split('T')[0];

            filteredTasks.forEach(t => {
                let proj = projectCache.find(p => p.id == t.project_id) || { name: 'Unknown', color: '#ccc' };
                let deadlineBadge = '';
                if (t.status === 'done') deadlineBadge = `<span class="badge success"><i data-lucide="check" class="w-3 h-3"></i> Selesai</span>`;
                else if (t.deadline < today) deadlineBadge = `<span class="badge danger"><i data-lucide="alert-triangle" class="w-3 h-3"></i> Terlambat</span>`;
                else if (t.deadline === today) deadlineBadge = `<span class="badge warning"><i data-lucide="clock" class="w-3 h-3"></i> Hari Ini</span>`;
                else deadlineBadge = `<span class="text-sm text-slate-600">${t.deadline}</span>`;

                let progress = '';
                if (t.subtasks && t.subtasks.length > 0) {
                    let doneC = t.subtasks.filter(s => s.done).length;
                    progress = `<div class="text-[11px] mt-1 text-slate-400 flex items-center gap-1"><i data-lucide="list-checks" class="w-3 h-3"></i> ${Math.round((doneC / t.subtasks.length) * 100)}%</div>`;
                }

                let statusHtml = "";
                if (t.status === "todo") statusHtml = `<span class="badge warning status-toggle" onclick="toggleStatus(${t.id}, 'progress')">Todo</span>`;
                else if (t.status === "progress") statusHtml = `<span class="badge" style="background:#DBEAFE;color:#2563EB;" onclick="toggleStatus(${t.id}, 'done')">Progress</span>`;
                else statusHtml = `<span class="badge success status-toggle" onclick="toggleStatus(${t.id}, 'todo')">Done</span>`;

                let attArray = [];
                if (t.attachment) { try { attArray = JSON.parse(t.attachment); if(!Array.isArray(attArray)) attArray=[t.attachment]; } catch(e) { attArray = [t.attachment]; } }
                let lampiranHtml = attArray.length > 0 ? `<a href="${attArray[0]}" target="_blank" class="text-brand-600 text-sm hover:underline flex items-center gap-1"><i data-lucide="paperclip" class="w-3.5 h-3.5"></i> ${attArray.length} File</a>` : '-';

                html += `
                    <tr class="hover:bg-slate-50/80 transition-colors">
                        <td class="text-center px-5 py-4 align-middle"><input type="checkbox" class="custom-checkbox" ${t.status === 'done' ? 'checked' : ''} onclick="toggleStatus(${t.id}, '${t.status === 'todo' ? 'progress' : t.status === 'progress' ? 'done' : 'todo'}')"></td>
                        <td class="px-5 py-4 align-middle"><div class="flex flex-col gap-1 min-w-[200px] whitespace-normal"><span class="font-semibold text-slate-900">${t.title}</span>${t.description ? `<span class="text-xs text-slate-500 line-clamp-2 leading-relaxed">${t.description}</span>` : ''}${progress}</div></td>
                        <td class="px-5 py-4 align-middle"><span class="badge badge-project cursor-pointer hover:border-brand-500 hover:shadow-sm transition-all w-40 justify-start" onclick="openProject(${t.project_id})" title="${proj.name}"><i data-lucide="folder" class="w-3 h-3 shrink-0" style="color:${proj.color}"></i> <span class="truncate text-left w-full">${proj.name}</span></span></td>
                        <td class="px-5 py-4 align-middle">${deadlineBadge}</td>
                        <td class="px-5 py-4 align-middle">${statusHtml}</td>
                        <td class="px-5 py-4 align-middle">${lampiranHtml}</td>
                        <td class="px-5 py-4 align-middle"><div class="flex gap-2"><button class="action-btn" onclick='editTask(${JSON.stringify(t).replace(/'/g, "&#39;")})'><i data-lucide="pencil" class="w-4 h-4"></i></button><button class="action-btn text-red-500 hover:text-red-700 hover:bg-red-50" onclick="confirmDelete(${t.id}, 'task')"><i data-lucide="trash-2" class="w-4 h-4"></i></button></div></td>
                    </tr>`;
            });
            tableBody.innerHTML = html; lucide.createIcons();
        }

        async function renderProjects() { /* ... existing renderProjects ... */ 
            const container = document.getElementById("projectList");
            const projects = projectCache; const tasks = tasksCache;
            
            if (projects.length === 0) {
                container.innerHTML = `<div class="col-span-full flex flex-col items-center justify-center py-16 bg-white rounded-2xl border border-slate-200 border-dashed"><i data-lucide="folder-open" class="w-12 h-12 text-slate-300 mb-4"></i><h3 class="text-lg font-bold text-slate-700 mb-1">Belum Ada Project</h3><p class="text-slate-500 text-sm mb-6">Silakan tambahkan project pertama Anda.</p><button onclick="openProjectModal()" class="btn btn-outline"><i data-lucide="plus" class="w-4 h-4"></i> Tambah Project</button></div>`;
                lucide.createIcons(); return;
            }
                
            let html = "";
            projects.forEach(p => {
                const total = tasks.filter(t => t.project_id == p.id).length;
                const todo = tasks.filter(t => t.project_id == p.id && t.status == "todo").length;
                const progress = tasks.filter(t => t.project_id == p.id && t.status == "progress").length;
                const done = tasks.filter(t => t.project_id == p.id && t.status == "done").length;
                const percent = total == 0 ? 0 : Math.round(((done * 1) + (progress * 0.5)) / total * 100);
                const nearest = tasks.filter(t => t.project_id == p.id).sort((a,b) => new Date(a.deadline) - new Date(b.deadline))[0];
                const dateDisplay = nearest ? new Date(nearest.deadline).toLocaleDateString("id-ID", { day:"2-digit", month:"short", year:"numeric" }) : "-";
                const projColor = p.color || "#3b82f6";
                    
                html += `<div class="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm hover:shadow-lg transition-all duration-300 relative overflow-hidden group flex flex-col h-full cursor-pointer" onclick="openProject(${p.id})"><div class="absolute top-0 left-0 w-full h-1.5" style="background-color: ${projColor}"></div><div class="flex-1"><h4 class="font-bold text-slate-900 text-lg mb-1 group-hover:opacity-80 transition-opacity" style="color: ${projColor}">${p.name}</h4><p class="text-sm text-slate-500 mb-6 line-clamp-2 min-h-[40px]">${p.description || "-"}</p><div class="mb-5"><div class="flex justify-between items-end mb-2"><span class="text-[11px] font-medium text-slate-400 uppercase tracking-wider">${done} dari ${total} Task selesai</span><span class="text-sm font-bold" style="color: ${projColor}">${percent}%</span></div><div class="w-full h-2 bg-slate-100 rounded-full overflow-hidden"><div class="h-full rounded-full transition-all duration-500 ease-out" style="width: ${percent}%; background-color: ${projColor}"></div></div></div><div class="space-y-2 text-sm mb-6 bg-slate-50 p-3 rounded-xl border border-slate-100"><div class="flex justify-between items-center text-slate-600"><span class="text-xs">Todo :</span><span class="font-semibold text-slate-900">${todo}</span></div><div class="flex justify-between items-center text-slate-600"><span class="text-xs">Progress :</span><span class="font-semibold text-slate-900">${progress}</span></div><div class="flex justify-between items-center text-slate-600"><span class="text-xs">Done :</span><span class="font-semibold text-slate-900">${done}</span></div></div></div><div class="mt-auto pt-4 border-t border-slate-100"><div class="flex items-center gap-2 text-xs font-medium text-slate-500 mb-4 w-fit px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-100"><i data-lucide="calendar" class="w-3.5 h-3.5 text-slate-400"></i> ${dateDisplay}</div><div class="flex gap-3"><button onclick="event.stopPropagation(); editProject(${JSON.stringify(p).replace(/'/g, "&#39;")})" class="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-brand-50 text-brand-600 hover:bg-brand-100 text-sm font-semibold transition-colors"><i data-lucide="pencil" class="w-4 h-4"></i> Edit</button><button onclick="event.stopPropagation(); confirmDelete(${p.id}, 'project')" class="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 text-sm font-semibold transition-colors"><i data-lucide="trash-2" class="w-4 h-4"></i> Hapus</button></div></div></div>`;
            });
            container.innerHTML = html; lucide.createIcons();
        }

        async function openProject(projectId){
            currentProjectId = projectId;
            const project = projectCache.find(p=>p.id==projectId); if (!project) return;
            const tasks = tasksCache.filter(t=>t.project_id==projectId);
            
            ['dashboardPage','projectPage','taskPage','kanbanPage','archivePage','documentsPage','notesPage','reportsPage'].forEach(id => document.getElementById(id).style.display='none');
            document.getElementById("projectDetailPage").style.display="block";
            
            document.getElementById("mainHeaderTitle").innerText = project.name;
            document.getElementById("mainHeaderDesc").innerText = project.description || "Detail pekerjaan untuk project ini.";
            document.getElementById("btnEditProjectDetail").style.display = "inline-flex";
            document.getElementById("btnEditProjectDetail").onclick = () => { editProject(project); };

            renderProjectCards(tasks); renderProjectResources(projectId); activateMenu(document.getElementById("menu-project"));
        }

        function renderProjectCards(tasks) {
            const container = document.getElementById("projectTaskCards");
            if (tasks.length === 0) { container.innerHTML = `<div class="col-span-full text-center py-10 text-slate-500">Belum ada task di project ini.</div>`; return; }
            let html = "";
            tasks.forEach(task => {
                let attArray = []; if (task.attachment) { try { attArray = JSON.parse(task.attachment); if(!Array.isArray(attArray)) attArray=[task.attachment]; } catch(e) { attArray = [task.attachment]; } }
                let attachmentsHTML = attArray.length > 0 ? `<div class="mt-3 pt-3 border-t border-slate-100"><div class="flex flex-wrap gap-2">` + attArray.map((url, i) => `<a href="${url}" target="_blank" class="text-xs bg-slate-50 text-slate-600 px-2 py-1 rounded border border-slate-200 flex items-center gap-1 hover:bg-slate-100 transition-colors"><i data-lucide="paperclip" class="w-3 h-3"></i> File ${i+1}</a>`).join("") + `</div></div>` : "";
                let subtasksHTML = (task.subtasks && task.subtasks.length > 0) ? `<div class="mt-4 pt-3 border-t border-slate-100"><div class="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1"><i data-lucide="list-checks" class="w-3.5 h-3.5"></i> Checklist</div>` + task.subtasks.map((sub, idx) => `<div class="flex items-center gap-2 mb-1"><input type="checkbox" onchange="updateSubtaskStatus(${task.id}, ${idx}, this.checked)" ${sub.done ? "checked" : ""} class="custom-checkbox w-3.5 h-3.5"><span class="text-xs ${sub.done ? 'line-through text-slate-400' : 'text-slate-600'}">${sub.title}</span></div>`).join("") + `</div>` : "";
                
                html += `<div class="bg-white rounded-xl p-5 border border-slate-200 shadow-sm flex flex-col justify-between hover:shadow-md transition-all"><div><h3 class="font-bold text-slate-900">${task.title}</h3><p class="text-sm text-slate-500 mt-1">${task.description || "-"}</p>${subtasksHTML}${attachmentsHTML}</div><div class="mt-4 pt-4 border-t border-slate-50 flex items-center justify-between"><div class="flex flex-wrap gap-2"><span class="text-[11px] bg-slate-50 border border-slate-100 text-slate-600 px-2 py-1 rounded-md flex items-center gap-1"><i data-lucide="calendar" class="w-3 h-3"></i> ${task.deadline}</span><span class="text-[11px] bg-brand-50 text-brand-600 px-2 py-1 rounded-md font-medium uppercase">${task.status}</span></div><div class="flex items-center gap-1"><button class="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-md transition-colors" onclick='editTask(${JSON.stringify(task).replace(/'/g, "&#39;")})'><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button><button class="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors" onclick="confirmDelete(${task.id}, 'task')"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button></div></div></div>`;
            });
            container.innerHTML = html; lucide.createIcons();
        }

        window.updateSubtaskStatus = async function(taskId, index, checked) {
            try {
                const task = tasksCache.find(t=>t.id==taskId);
                if (task && task.subtasks) {
                    task.subtasks[index].done = checked;
                    await client.from("tasks").update({ subtasks: task.subtasks }).eq("id", taskId);
                    await loadStats(); 
                }
            } catch(e) { showToast("Gagal mengubah status checklist", "danger"); }
        }

        function backToProjects() { currentProjectId = null; document.getElementById("projectDetailPage").style.display="none"; document.getElementById("projectPage").style.display="block"; document.getElementById("mainHeaderTitle").innerText="Project"; document.getElementById("mainHeaderDesc").innerText="Kelola seluruh project."; }

        async function renderArchive(){
            const { data: tasks } = await client.from("tasks").select("*").eq("archived", true);
            const container = document.getElementById("archiveTableBody");
            if(!tasks || tasks.length === 0){ container.innerHTML = `<tr><td colspan="6" class="text-center py-12 text-slate-500">Belum ada data arsip.</td></tr>`; return; }
            
            const keyword = document.getElementById("archiveSearch").value.toLowerCase();
            let html = "";
            tasks.filter(t => { const proj = projectCache.find(p => p.id == t.project_id); return t.title.toLowerCase().includes(keyword) || (proj?.name || "").toLowerCase().includes(keyword); }).forEach(task => {
                const project = projectCache.find(p=>p.id==task.project_id); const archivedDate = task.archived_at ? new Date(task.archived_at).toLocaleDateString("id-ID", { day:"2-digit", month:"short", year:"numeric" }) : "-";
                html += `<tr class="hover:bg-slate-50/80 transition-colors"><td class="px-5 py-4 align-middle"><div class="font-semibold text-slate-900">${task.title}</div><div class="text-xs text-slate-500 mt-1 max-w-[250px] truncate">${task.description || "-"}</div></td><td class="px-5 py-4 align-middle"><span class="badge badge-project w-40 justify-start" title="${project?.name || "-"}"><i data-lucide="folder" class="w-3 h-3 shrink-0"></i> <span class="truncate text-left w-full">${project?.name || "-"}</span></span></td><td class="px-5 py-4 align-middle"><span class="text-xs uppercase font-semibold text-slate-500">${task.status}</span></td><td class="px-5 py-4 align-middle text-sm text-slate-600">${task.deadline || "-"}</td><td class="px-5 py-4 align-middle text-sm text-slate-600">${archivedDate}</td><td class="px-5 py-4 align-middle"><div class="flex gap-2"><button class="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition" onclick="restoreTask(${task.id})"><i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i> Restore</button><button class="bg-white border border-red-200 hover:bg-red-50 text-red-600 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition" onclick="deleteForever(${task.id})"><i data-lucide="trash" class="w-3.5 h-3.5"></i> Hapus</button></div></td></tr>`;
            });
            container.innerHTML = html; lucide.createIcons();
        }

        function handleSearch() { clearTimeout(searchTimeout); searchTimeout = setTimeout(() => { renderTable(); }, 300); }
        function resetFilters() { document.getElementById('searchInput').value = ''; document.getElementById('filterProject').value = ''; document.getElementById('filterStatus').value = ''; document.getElementById('sortData').value = 'deadline_asc'; renderTable(); }
        function activateMenu(el) {
            document.querySelectorAll(".menu-item").forEach(m => { m.classList.remove("bg-brand-50", "text-brand-600", "active-menu"); m.classList.add("text-slate-600"); const icon = m.querySelector('i'); if(icon) { icon.classList.remove("text-brand-600"); icon.classList.add("text-slate-400"); } });
            el.classList.remove("text-slate-600"); el.classList.add("bg-brand-50", "text-brand-600", "active-menu"); const activeIcon = el.querySelector('i'); if(activeIcon) { activeIcon.classList.remove("text-slate-400"); activeIcon.classList.add("text-brand-600"); }
        }
        function hideAllPages() { ['dashboardPage','taskPage','kanbanPage','projectPage','projectDetailPage','archivePage','documentsPage','notesPage','reportsPage'].forEach(id => document.getElementById(id).style.display='none'); }

        async function showDashboard(e) { if(e) e.preventDefault(); activateMenu(document.getElementById("menu-dashboard")||e.currentTarget); document.getElementById("mainHeaderTitle").innerText = "Dashboard"; document.getElementById("mainHeaderDesc").innerText = "Ringkasan aktivitas dan pekerjaan Anda."; hideAllPages(); document.getElementById("dashboardPage").style.display="block"; await refreshAll(); }
        async function showAllTasks(e) { if(e) e.preventDefault(); activateMenu(document.getElementById("menu-semua-task")||e.currentTarget); document.getElementById("mainHeaderTitle").innerText = "Semua Task"; document.getElementById("mainHeaderDesc").innerText = "Kelola semua tugas dari berbagai project dalam satu tempat."; hideAllPages(); document.getElementById("taskPage").style.display="block"; await refreshAll(); }
        async function showKanban(e) { if(e) e.preventDefault(); activateMenu(document.getElementById("menu-kanban")||e.currentTarget); document.getElementById("mainHeaderTitle").innerText = "Papan Kanban"; document.getElementById("mainHeaderDesc").innerText = "Kelola progres pekerjaan Anda dengan tampilan papan visual interaktif."; hideAllPages(); document.getElementById("kanbanPage").style.display="block"; await refreshAll(); }
        async function showProjects(e) { if(e) e.preventDefault(); activateMenu(document.getElementById("menu-project")||e.currentTarget); document.getElementById("mainHeaderTitle").innerText = "Project"; document.getElementById("mainHeaderDesc").innerText = "Kelola seluruh project."; hideAllPages(); document.getElementById("projectPage").style.display="block"; await renderProjects(); }
        async function showArchive(e) { if(e) e.preventDefault(); activateMenu(document.getElementById("menu-arsip")||e.currentTarget); document.getElementById("mainHeaderTitle").innerText = "Arsip Task"; document.getElementById("mainHeaderDesc").innerText = "Task yang telah diarsipkan masih dapat dipulihkan."; hideAllPages(); document.getElementById("archivePage").style.display="block"; await renderArchive(); }
        async function showDocuments(e) { if(e) e.preventDefault(); activateMenu(document.getElementById('menu-documents')); document.getElementById('mainHeaderTitle').innerText = 'Dokumen'; document.getElementById('mainHeaderDesc').innerText = 'Arsip dokumen setiap project.'; hideAllPages(); document.getElementById('documentsPage').style.display='block'; await loadResources(); }
        async function showNotes(e) { if(e) e.preventDefault(); activateMenu(document.getElementById('menu-notes')); document.getElementById('mainHeaderTitle').innerText = 'Catatan'; document.getElementById('mainHeaderDesc').innerText = 'Catatan terhubung ke project.'; hideAllPages(); document.getElementById('notesPage').style.display='block'; await loadResources(); }
        async function showReports(e) { if(e) e.preventDefault(); activateMenu(document.getElementById('menu-reports')); document.getElementById('mainHeaderTitle').innerText='Laporan'; document.getElementById('mainHeaderDesc').innerText='Ringkasan project dan task yang dapat diunduh.'; hideAllPages(); document.getElementById('reportsPage').style.display='block'; await loadReportSummary(); }

        async function toggleStatus(id, newStatus) { await client.from("tasks").update({ status: newStatus }).eq("id", id); showToast("Status berhasil diubah","success"); await refreshAll(); }
        function openProjectModal() { document.getElementById('project_id').value = ''; document.getElementById('projectName').value = ''; document.getElementById('projectDesc').value = ''; document.getElementById('projectModalTitle').innerText = 'Tambah Project Baru'; document.getElementById('projectModal').classList.add('active'); }
        function editProject(project) { document.getElementById("projectModal").classList.add("active"); document.getElementById("projectModalTitle").innerText = "Edit Info Project"; document.getElementById("project_id").value = project.id; document.getElementById("projectName").value = project.name; document.getElementById("projectDesc").value = project.description || ""; document.querySelectorAll(".color-btn").forEach(btn => { btn.classList.remove("active"); if(btn.dataset.color == project.color) btn.classList.add("active"); }); }
        function selectColor(el) { document.querySelectorAll('.color-btn').forEach(btn => btn.classList.remove('active')); el.classList.add('active'); }
        async function saveProject() {
            const name = document.getElementById('projectName').value; if (!name) return showToast("Nama project wajib diisi", "danger");
            const data = { id: document.getElementById('project_id').value || null, name: name, description: document.getElementById('projectDesc').value, color: document.querySelector('.color-btn.active').getAttribute('data-color'), };
            try { if (data.id) await client.from("projects").update({ name: data.name, description: data.description, color: data.color }).eq("id", data.id); else await client.from("projects").insert([{ name: data.name, description: data.description, color: data.color }]); showToast(data.id ? "Project diperbarui" : "Project ditambahkan", "success"); closeModal("projectModal"); await refreshAll(); } catch (err) { showToast(err.message, "danger"); }
        }

        window.handleFileChange = function(event) {
            const fileInput = event.target; let totalSize = 0; Array.from(fileInput.files).forEach(f => totalSize += f.size);
            if (totalSize > 10 * 1024 * 1024) { showToast("Total ukuran file baru maksimal 10MB", "danger"); fileInput.value = ''; }
            renderAttachmentUI();
        }
        function renderAttachmentUI() {
            const container = document.getElementById('currentFileDisplay'); let html = '';
            existingAttachments.forEach((url, i) => {
                let fileName = url.split('/').pop().split('?')[0] || `Lampiran ${i+1}`; try { fileName = decodeURIComponent(fileName); } catch(e){}
                fileName = fileName.replace(/^\d+_/, '');
                html += `<div class="flex items-center justify-between text-xs bg-slate-50 p-2 rounded mb-1 border border-slate-200"><a href="${url}" target="_blank" class="text-brand-600 truncate flex-1 flex items-center gap-1 hover:underline"><i data-lucide="paperclip" class="w-3 h-3"></i> ${fileName}</a><button type="button" class="text-red-500 hover:text-red-700 ml-2 p-1 bg-white border border-red-100 rounded" onclick="removeExistingAttachment(${i})" title="Hapus File"><i data-lucide="x" class="w-3 h-3"></i></button></div>`;
            });
            const fileInput = document.getElementById('taskFile');
            if (fileInput && fileInput.files.length > 0) {
                Array.from(fileInput.files).forEach((file) => { html += `<div class="flex items-center justify-between text-xs bg-blue-50 p-2 rounded mb-1 border border-blue-100"><span class="text-blue-700 truncate flex-1 flex items-center gap-1"><i data-lucide="upload-cloud" class="w-3 h-3"></i> ${file.name} (Akan Diupload)</span></div>`; });
            }
            container.innerHTML = html; lucide.createIcons();
        }
        window.removeExistingAttachment = function(index) { existingAttachments.splice(index, 1); renderAttachmentUI(); }

        function openTaskModal() {
            existingAttachments = []; document.getElementById('taskId').value = ''; document.getElementById('taskTitle').value = ''; document.getElementById('taskDesc').value = ''; document.getElementById('taskDeadline').value = ''; document.getElementById('taskFile').value = ''; document.getElementById('checklistContainer').innerHTML = ''; document.getElementById('taskModalTitle').innerText = 'Tambah Task Baru'; renderAttachmentUI();
            if (document.getElementById('taskProject').options.length === 0) { showToast("Silakan buat Project terlebih dahulu", "warning"); return; }
            if(currentProjectId) document.getElementById("taskProject").value = currentProjectId;
            document.getElementById('taskModal').classList.add('active');
        }

        function editTask(task) {
            openTaskModal(); document.getElementById('taskModalTitle').innerText = 'Edit Task'; document.getElementById('taskId').value = task.id; document.getElementById('taskProject').value = task.project_id; document.getElementById('taskTitle').value = task.title; document.getElementById('taskDeadline').value = task.deadline; document.getElementById('taskDesc').value = task.description; document.getElementById("taskStatus").value= task.status;
            existingAttachments = [];
            if (task.attachment) { try { const parsed = JSON.parse(task.attachment); if (Array.isArray(parsed)) existingAttachments = parsed; else existingAttachments = [task.attachment]; } catch(e) { existingAttachments = [task.attachment]; } }
            renderAttachmentUI();
            if(task.subtasks) task.subtasks.forEach(st => addChecklistItem(st.title, st.done));
        }

        function addChecklistItem(title = '', done = false) { const container = document.getElementById('checklistContainer'); const div = document.createElement('div'); div.className = 'checklist-item'; div.innerHTML = `<input type="checkbox" class="custom-checkbox chk-done" ${done ? 'checked' : ''}><input type="text" class="chk-title" placeholder="Nama subtask..." value="${title}"><i data-lucide="trash" class="w-4 h-4 text-red-500 cursor-pointer" onclick="this.parentElement.remove()"></i>`; container.appendChild(div); lucide.createIcons(); }
        async function uploadAttachment(file){ if(!file) return ""; const fileName=`${Date.now()}_${file.name.replace(/\s+/g, '_')}`; const {error}=await client.storage.from("attachments").upload(fileName,file,{upsert:true}); if(error) throw error; return client.storage.from("attachments").getPublicUrl(fileName).data.publicUrl; }

        async function saveTask() {
            const title = document.getElementById('taskTitle').value; const project_id = document.getElementById('taskProject').value; const deadline = document.getElementById('taskDeadline').value;
            if (!title || !project_id || !deadline) return showToast("Mohon lengkapi field wajib (*)", "danger");
            const btn = document.getElementById('btnSaveTask'); btn.innerHTML = '<div class="spinner"></div> Menyimpan...'; btn.disabled = true;
            let subtasks = []; document.querySelectorAll('.checklist-item').forEach(el => { let txt = el.querySelector('.chk-title').value; let done = el.querySelector('.chk-done').checked; if (txt) subtasks.push({ title: txt, done: done }); });
            
            let finalAttachments = [...existingAttachments]; const fileInput = document.getElementById('taskFile');
            if (fileInput.files.length > 0) {
                try { for (let i = 0; i < fileInput.files.length; i++) { let url = await uploadAttachment(fileInput.files[i]); if (url) finalAttachments.push(url); } } 
                catch(err) { showToast("Upload lampiran gagal", "danger"); btn.innerHTML = "Simpan Task"; btn.disabled = false; return; }
            }
            const attachmentData = finalAttachments.length > 0 ? JSON.stringify(finalAttachments) : null;
            const data = { project_id: Number(project_id), title: title, deadline: deadline, description: document.getElementById('taskDesc').value, subtasks: subtasks, attachment: attachmentData, status: document.getElementById("taskStatus").value };
            const id = document.getElementById('taskId').value;
            try { if(id) await client.from("tasks").update(data).eq("id",id); else await client.from("tasks").insert([data]); showToast("Task disimpan","success"); closeModal("taskModal"); await refreshAll(); } catch(e) { showToast("Terjadi kesalahan simpan", "danger"); } finally { btn.innerHTML = 'Simpan Task'; btn.disabled = false; }
        }

        function confirmDelete(id,type){ document.getElementById("deleteTargetId").value=id; document.getElementById("deleteTargetType").value=type; const project = type === 'project'; document.getElementById('deleteModalTitle').innerText=project?'Hapus Project Permanen':'Arsipkan Task'; document.getElementById('deleteConfirmButton').innerText=project?'Ya, Hapus Permanen':'Ya, Arsipkan'; document.getElementById("deleteMsg").innerHTML=project?'Project beserta seluruh task di dalamnya akan dihapus permanen dan tidak dapat dipulihkan.':'Apakah Anda yakin ingin mengarsipkan task ini?'; document.getElementById("deleteModal").classList.add("active"); }
        async function executeDelete(){ const id=document.getElementById("deleteTargetId").value; const type=document.getElementById("deleteTargetType").value; if(type=="task") { await client.from("tasks").update({archived:true, archived_at:new Date().toISOString()}).eq("id",id); closeModal("deleteModal"); showToast("Task diarsipkan","success"); } else { await client.from("tasks").delete().eq("project_id",id); await client.from("projects").delete().eq("id",id); closeModal("deleteModal"); showToast("Project dihapus permanen","success"); } await refreshAll(); }
        function openDocumentModal(projectId = '') { document.getElementById('documentId').value = ''; document.getElementById('documentName').value = ''; document.getElementById('documentDescription').value = ''; document.getElementById('documentUrl').value = ''; document.getElementById('documentExistingUrl').value=''; document.getElementById('documentFile').value=''; document.getElementById('documentProject').value = projectId || ''; document.getElementById('documentModalTitle').innerText = 'Tambah Dokumen'; document.getElementById('documentModal').classList.add('active'); }
        function editDocument(id) { const d = documentsData.find(x => String(x.id) === String(id)); if (!d) return; document.getElementById('documentId').value=d.id; document.getElementById('documentProject').value=d.project_id; document.getElementById('documentName').value=d.name; document.getElementById('documentDescription').value=d.description || ''; document.getElementById('documentUrl').value=d.file_url || ''; document.getElementById('documentExistingUrl').value=d.file_url || ''; document.getElementById('documentFile').value=''; document.getElementById('documentModalTitle').innerText='Edit Dokumen'; document.getElementById('documentModal').classList.add('active'); }
        async function saveDocument() { const id=document.getElementById('documentId').value, input=document.getElementById('documentFile'); let fileUrl=document.getElementById('documentUrl').value.trim() || document.getElementById('documentExistingUrl').value; if(input.files[0]) { if(input.files[0].size > 10 * 1024 * 1024) return showToast('Ukuran dokumen maksimal 10MB','danger'); try { fileUrl=await uploadAttachment(input.files[0]); } catch(e) { return showToast('Upload dokumen gagal. Pastikan bucket attachments tersedia.','danger'); } } const data={project_id:Number(document.getElementById('documentProject').value), name:document.getElementById('documentName').value.trim(), description:document.getElementById('documentDescription').value.trim(), file_url:fileUrl}; if(!data.project_id || !data.name) return showToast('Project dan nama dokumen wajib diisi','danger'); const result=id ? await client.from('documents').update(data).eq('id',id) : await client.from('documents').insert([data]); if(result.error) { const rows=localRows('documents'); if(id) { const i=rows.findIndex(x=>String(x.id)===String(id)); rows[i]={...rows[i],...data}; } else rows.unshift({id:Date.now(),...data,created_at:new Date().toISOString()}); saveLocalRows('documents',rows); showToast('Tabel documents belum tersedia; disimpan lokal. Jalankan SQL pendukung untuk sinkronisasi Supabase.','warning'); } else showToast('Dokumen disimpan','success'); closeModal('documentModal'); await loadResources(); if(currentProjectId) renderProjectResources(currentProjectId); }
        async function deleteDocument(id) { if(!confirm('Hapus dokumen ini?')) return; const r=await client.from('documents').delete().eq('id',id); if(r.error) saveLocalRows('documents',localRows('documents').filter(x=>String(x.id)!==String(id))); await loadResources(); if(currentProjectId) renderProjectResources(currentProjectId); }
        let noteSavedRange = null;
        function noteKeepSelection(event) { const selection=window.getSelection(); if(selection && selection.rangeCount) noteSavedRange=selection.getRangeAt(0).cloneRange(); if(event && event.target?.tagName!=='INPUT') event.preventDefault(); }
        document.addEventListener('selectionchange', () => { const editor=document.getElementById('noteContent'), selection=window.getSelection(); if(editor && selection && selection.rangeCount && editor.contains(selection.anchorNode)) noteSavedRange=selection.getRangeAt(0).cloneRange(); });
        function noteRestoreSelection() { const editor=document.getElementById('noteContent'); editor.focus(); if(noteSavedRange){const selection=window.getSelection();selection.removeAllRanges();selection.addRange(noteSavedRange);} }
        function noteCommand(command) { noteRestoreSelection(); document.execCommand(command,false,null); }
        function noteFormatBlock(tag) { noteRestoreSelection(); document.execCommand('formatBlock',false,tag); }
        function noteFontSize(size) { noteRestoreSelection(); document.execCommand('fontSize',false,size); }
        function noteColor(command,color) { noteRestoreSelection(); document.execCommand(command,false,color); }
        function noteInsertLink() { const url=prompt('Masukkan alamat tautan (URL):'); if(!url)return; if(!/^(https?:|mailto:)/i.test(url))return showToast('Gunakan tautan http, https, atau email','danger'); noteRestoreSelection(); document.execCommand('createLink',false,url); }
        function noteInsertTable() { const rows=Math.max(1,Math.min(12,Number(prompt('Jumlah baris tabel?',3))||3)),cols=Math.max(1,Math.min(8,Number(prompt('Jumlah kolom?',3))||3)); let html='<table><tbody>'; for(let r=0;r<rows;r++){html+='<tr>';for(let c=0;c<cols;c++)html+=r===0?'<th>Judul</th>':'<td><br></td>';html+='</tr>';} html+='</tbody></table><p><br></p>'; noteRestoreSelection(); document.execCommand('insertHTML',false,html); }
        function noteSanitize(value='') { const raw=String(value||''); if(!/<[a-z][\s\S]*>/i.test(raw)) return raw.split(/\r?\n/).map(line=>`<p>${esc(line)||'<br>'}</p>`).join(''); const doc=new DOMParser().parseFromString(raw,'text/html'), allowed=new Set(['P','DIV','BR','H1','H2','H3','STRONG','B','EM','I','U','S','DEL','UL','OL','LI','BLOCKQUOTE','TABLE','THEAD','TBODY','TR','TH','TD','A','SPAN','FONT','HR']); const clean=node=>{[...node.childNodes].forEach(child=>{if(child.nodeType===1){if(!allowed.has(child.tagName)){child.replaceWith(...child.childNodes);return clean(node);} [...child.attributes].forEach(attr=>{const key=attr.name.toLowerCase();if(key==='style'){const rules=[],color=child.style.color,size=child.style.fontSize;if(color && /^(#[0-9a-f]{3,8}|rgb\(|rgba\(|[a-z]+$)/i.test(color))rules.push(`color:${color}`);if(size && /^\d{1,3}(\.\d+)?(px|pt|em|rem|%)$/i.test(size))rules.push(`font-size:${size}`);if(rules.length)child.setAttribute('style',rules.join(';'));else child.removeAttribute('style');}else if(child.tagName==='A'&&key==='href'&&/^(https?:|mailto:)/i.test(attr.value)){}else if(child.tagName==='FONT'&&key==='size'&&/^[1-7]$/.test(attr.value)){}else if(child.tagName==='FONT'&&key==='color'&&/^(#[0-9a-f]{3,8}|[a-z]+)$/i.test(attr.value)){}else child.removeAttribute(attr.name);});clean(child);}else if(child.nodeType!==3)child.remove();});}; clean(doc.body); return doc.body.innerHTML; }
        function notePreview(value='') { const doc=new DOMParser().parseFromString(String(value||''),'text/html'); return (doc.body.textContent||'').replace(/\s+/g,' ').trim(); }
        function openNoteModal(projectId = '') { document.getElementById('noteId').value=''; document.getElementById('noteProject').value=projectId || ''; document.getElementById('noteTitle').value=''; document.getElementById('noteContent').innerHTML=''; document.getElementById('noteUrl').value=''; document.getElementById('noteModalTitle').innerText='Tambah Catatan'; noteSavedRange=null; document.getElementById('noteModal').classList.add('active'); setTimeout(()=>document.getElementById('noteTitle').focus(),50); }
        function editNote(id) { const n=notesData.find(x=>String(x.id)===String(id)); if(!n)return; document.getElementById('noteId').value=n.id; document.getElementById('noteProject').value=n.project_id; document.getElementById('noteTitle').value=n.title; document.getElementById('noteContent').innerHTML=noteSanitize(n.content); document.getElementById('noteUrl').value=n.link_url || ''; document.getElementById('noteModalTitle').innerText='Edit Catatan'; noteSavedRange=null; document.getElementById('noteModal').classList.add('active'); }
        async function saveNote() { const id=document.getElementById('noteId').value, content=noteSanitize(document.getElementById('noteContent').innerHTML), data={project_id:Number(document.getElementById('noteProject').value),title:document.getElementById('noteTitle').value.trim(),content,link_url:document.getElementById('noteUrl').value.trim()}; if(!data.project_id||!data.title||!notePreview(content))return showToast('Project, judul, dan isi catatan wajib diisi','danger'); const r=id?await client.from('notes').update(data).eq('id',id):await client.from('notes').insert([data]); if(r.error){const rows=localRows('notes');if(id){const i=rows.findIndex(x=>String(x.id)===String(id));if(i>=0)rows[i]={...rows[i],...data};}else rows.unshift({id:Date.now(),...data,created_at:new Date().toISOString()});saveLocalRows('notes',rows);showToast('Catatan disimpan lokal. Sinkronisasi Supabase belum tersedia.','warning');}else showToast('Catatan disimpan','success');closeModal('noteModal');await loadResources();if(currentProjectId)renderProjectResources(currentProjectId); }
        async function deleteNote(id) { if(!confirm('Hapus catatan ini?'))return;const r=await client.from('notes').delete().eq('id',id);if(r.error)saveLocalRows('notes',localRows('notes').filter(x=>String(x.id)!==String(id)));await loadResources();if(currentProjectId)renderProjectResources(currentProjectId); }
        async function getReportData() { const [{data:projects=[]},{data:tasks=[]}] = await Promise.all([client.from('projects').select('*').eq('archived',false),client.from('tasks').select('*').eq('archived',false)]); return {projects,tasks}; }
        async function loadReportSummary() { const {projects,tasks}=await getReportData(); document.getElementById('reportProjectCount').innerText=projects.length; document.getElementById('reportTaskCount').innerText=tasks.length; document.getElementById('reportDoneCount').innerText=tasks.filter(t=>t.status==='done').length; }
        async function downloadExcelReport() { const {projects,tasks}=await getReportData(); const projectRows=projects.map(p=>({Project:p.name,Deskripsi:p.description||'',Status:'Aktif'})); const taskRows=tasks.map(t=>({Task:t.title,Project:projects.find(p=>p.id==t.project_id)?.name||'-',Status:t.status,Deadline:t.deadline,Deskripsi:t.description||''})); const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(projectRows),'Project'); XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(taskRows),'Task'); XLSX.writeFile(wb,`GAWEDEUI-Laporan-${new Date().toISOString().slice(0,10)}.xlsx`); }
        async function downloadPdfReport() { const {projects,tasks}=await getReportData(); if(!window.jspdf) return showToast('Pustaka PDF belum termuat. Periksa koneksi internet.','danger'); const {jsPDF}=window.jspdf; const pdf=new jsPDF(); const date=new Date().toLocaleDateString('id-ID'); pdf.setFontSize(18); pdf.text('GAWEDEUI - Laporan Project & Task',14,18); pdf.setFontSize(10); pdf.text(`Dibuat: ${date} | Project aktif: ${projects.length} | Task selesai: ${tasks.filter(t=>t.status==='done').length}`,14,25); pdf.autoTable({startY:32,head:[['Task','Project','Status','Deadline']],body:tasks.map(t=>[t.title,projects.find(p=>p.id==t.project_id)?.name||'-',t.status,t.deadline||'-']),styles:{fontSize:8},headStyles:{fillColor:[37,99,235]}}); pdf.save(`GAWEDEUI-Laporan-${new Date().toISOString().slice(0,10)}.pdf`); }
        function toggleNotifications(e) { if(e)e.stopPropagation(); document.getElementById('notificationDropdown').classList.toggle('open'); }
        function renderNotifications() { const today=new Date().toISOString().slice(0,10); client.from('tasks').select('*').eq('archived',false).then(({data=[]})=>{const dueToday=data.filter(t=>t.status!=='done' && t.deadline===today);const overdue=data.filter(t=>t.status!=='done' && t.deadline && t.deadline<today);const items=[...dueToday.map(t=>({kind:'Hari ini',icon:'calendar-clock',color:'text-red-600 bg-red-50',text:t.title,sub:`Deadline hari ini · ${projectName(t.project_id)}`,project_id:t.project_id})),...overdue.map(t=>({kind:'Terlambat',icon:'alert-triangle',color:'text-red-600 bg-red-50',text:t.title,sub:`Deadline ${t.deadline} · ${projectName(t.project_id)}`,project_id:t.project_id})),...documentsData.slice(0,2).map(d=>({kind:'Dokumen',icon:'file-text',color:'text-brand-600 bg-brand-50',text:d.name,sub:projectName(d.project_id),project_id:d.project_id})),...notesData.slice(0,2).map(n=>({kind:'Catatan',icon:'sticky-note',color:'text-amber-600 bg-amber-50',text:n.title,sub:projectName(n.project_id),project_id:n.project_id}))];document.getElementById('notificationCount').innerText=dueToday.length?`${dueToday.length} deadline hari ini`:`${items.length} notifikasi`;const badge=document.getElementById('notificationBadge');badge.innerText=items.length;badge.classList.toggle('hidden',!items.length);document.getElementById('notificationList').innerHTML=items.length?items.map(i=>`<button onclick="openProject(${i.project_id});document.getElementById('notificationDropdown').classList.remove('open')" class="w-full text-left p-4 hover:bg-slate-50 flex gap-3"><span class="w-8 h-8 rounded-lg ${i.color} flex items-center justify-center shrink-0"><i data-lucide="${i.icon}" class="w-4 h-4"></i></span><span><b class="text-sm text-slate-800 block">${esc(i.text)}</b><span class="text-xs text-slate-500 block mt-1">${esc(i.kind)} · ${esc(i.sub)}</span></span></button>`).join(''):'<p class="p-6 text-center text-sm text-slate-500">Tidak ada notifikasi.</p>';lucide.createIcons();}); }
        document.addEventListener('click', e => { const dropdown=document.getElementById('notificationDropdown'); if(dropdown && !dropdown.parentElement.contains(e.target)) dropdown.classList.remove('open'); });
        function closeModal(id) { document.getElementById(id).classList.remove('active'); }
        function showToast(message, type = 'success') {
            const container = document.getElementById('toastContainer'); const toast = document.createElement('div'); toast.className = `toast ${type}`;
            toast.innerHTML = `<span>${message}</span>`; container.appendChild(toast);
            setTimeout(() => toast.classList.add('show'), 10); setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3000);
        }
        async function restoreTask(id){ await client.from("tasks").update({archived:false, archived_at:null}).eq("id",id); showToast("Task dipulihkan","success"); await refreshAll(); }
        async function deleteForever(id){ if(confirm("Hapus permanen?")){ await client.from("tasks").delete().eq("id",id); showToast("Dihapus permanen","success"); await renderArchive(); await refreshAll(); } }
        function toggleSidebar(){ document.getElementById("sidebar").classList.toggle("show"); document.getElementById("sidebarOverlay").classList.toggle("hidden"); }
