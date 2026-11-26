package com.scholargrid.teacher.data.local

import android.content.Context
import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Dao
interface TeacherDao {
    @Query("SELECT * FROM teacher_config WHERE id = 1")
    fun observeConfig(): Flow<TeacherConfigEntity?>

    @Query("SELECT * FROM teacher_config WHERE id = 1")
    suspend fun getConfig(): TeacherConfigEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveConfig(config: TeacherConfigEntity)

    @Query("SELECT * FROM timetable_sessions ORDER BY startTime ASC")
    fun observeTimetable(): Flow<List<TimetableSessionEntity>>

    @Query("DELETE FROM timetable_sessions")
    suspend fun clearTimetable()

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertTimetable(items: List<TimetableSessionEntity>)

    @Query("SELECT * FROM students WHERE className = :className AND section = :section ORDER BY studentCode ASC")
    fun observeCohortStudents(className: String, section: String): Flow<List<StudentEntity>>

    @Query("DELETE FROM students")
    suspend fun clearStudents()

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertStudents(items: List<StudentEntity>)

    @Query("SELECT * FROM attendance_sessions ORDER BY createdAt DESC")
    fun observeSessions(): Flow<List<AttendanceSessionDraftEntity>>

    @Query("SELECT * FROM attendance_sessions WHERE syncStatus IN ('PENDING_SYNC', 'ERROR')")
    suspend fun getPendingSessions(): List<AttendanceSessionDraftEntity>

    @Query("SELECT * FROM attendance_records WHERE sessionClientUuid = :sessionUuid")
    suspend fun getRecordsForSession(sessionUuid: String): List<AttendanceRecordEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertSession(session: AttendanceSessionDraftEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertRecords(records: List<AttendanceRecordEntity>)

    @Transaction
    suspend fun saveDraftOrQueue(
        session: AttendanceSessionDraftEntity,
        records: List<AttendanceRecordEntity>
    ) {
        upsertSession(session)
        upsertRecords(records)
    }

    @Query("UPDATE attendance_sessions SET syncStatus = 'SYNCED', syncedAt = :syncedAt, lastError = NULL WHERE clientUuid = :uuid")
    suspend fun markSessionSynced(uuid: String, syncedAt: String)

    @Query("UPDATE attendance_sessions SET syncStatus = 'CONFLICT', lastError = :reason WHERE clientUuid = :uuid")
    suspend fun markSessionConflict(uuid: String, reason: String)

    @Query("UPDATE attendance_sessions SET syncStatus = 'ERROR', lastError = :reason WHERE clientUuid = :uuid")
    suspend fun markSessionError(uuid: String, reason: String)

    @Query("DELETE FROM attendance_sessions WHERE syncStatus = 'SYNCED' AND syncedAt < :cutoffIso")
    suspend fun purgeOldSyncedSessions(cutoffIso: String)

    @Query("SELECT * FROM sync_logs ORDER BY timestamp DESC LIMIT 40")
    fun observeSyncLogs(): Flow<List<SyncLogEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSyncLog(log: SyncLogEntity)
}

@Database(
    entities = [
        TeacherConfigEntity::class,
        TimetableSessionEntity::class,
        StudentEntity::class,
        AttendanceSessionDraftEntity::class,
        AttendanceRecordEntity::class,
        SyncLogEntity::class
    ],
    version = 1,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun teacherDao(): TeacherDao

    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        fun getInstance(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "scholargrid_teacher_local.db"
                ).build().also { INSTANCE = it }
            }
        }
    }
}
