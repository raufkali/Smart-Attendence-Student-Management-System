package com.scholargrid.teacher.data.remote

import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.*
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient

data class HealthResponse(val ok: Boolean, val database: String?, val timestamp: String?)

data class PairRequest(
    val code: String,
    val device_id: String,
    val device_name: String,
    val app_version: String = "1.0.0"
)

data class MobileLoginRequest(
    val employee_id: String,
    val password: String,
    val device_id: String,
    val device_name: String
)

data class TeacherProfileDto(
    val id: Long,
    val employeeId: String,
    val fullName: String,
    val department: String,
    val photoUrl: String?
)

data class AuthResponse(
    val token: String,
    val teacher: TeacherProfileDto
)

data class PullTimetableDto(
    val id: Long,
    val day_of_week: String,
    val start_time: String,
    val end_time: String,
    val subject_id: Long,
    val course_code: String,
    val course_name: String,
    val class_name: String,
    val semester: String,
    val section: String,
    val room: String
)

data class PullStudentDto(
    val id: Long,
    val student_code: String,
    val full_name: String,
    val class_name: String,
    val semester: String,
    val section: String,
    val photo_url: String?
)

data class PullSyncResponse(
    val serverTime: String,
    val institutionName: String,
    val timetable: List<PullTimetableDto>,
    val students: List<PullStudentDto>
)

data class SyncRecordDto(
    val client_uuid: String,
    val student_id: Long,
    val status: String,
    val remarks: String,
    val marked_at: String
)

data class SyncSessionDto(
    val client_uuid: String,
    val timetable_session_id: Long,
    val session_date: String,
    val notes: String,
    val records: List<SyncRecordDto>
)

data class SyncAttendanceRequest(
    val sync_uuid: String,
    val device_id: String,
    val sessions: List<SyncSessionDto>
)

data class ConflictDetailDto(val client_uuid: String, val reason: String)

data class SyncAttendanceResponse(
    val ok: Boolean,
    val acceptedSessionUuids: List<String>?,
    val acceptedCount: Int,
    val duplicateCount: Int,
    val conflictCount: Int,
    val conflictDetails: List<ConflictDetailDto>?
)

interface LocalApiService {
    @GET("/api/health")
    suspend fun health(): HealthResponse

    @POST("/api/mobile/pair")
    suspend fun pairDevice(@Body body: PairRequest): AuthResponse

    @POST("/api/mobile/login")
    suspend fun loginTeacher(@Body body: MobileLoginRequest): AuthResponse

    @GET("/api/sync/pull")
    suspend fun pullTeacherData(@Header("Authorization") bearer: String): PullSyncResponse

    @POST("/api/sync/attendance")
    suspend fun syncAttendance(
        @Header("Authorization") bearer: String,
        @Body body: SyncAttendanceRequest
    ): SyncAttendanceResponse

    companion object {
        fun create(baseUrl: String): LocalApiService {
            val cleanUrl = if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/"
            val client = OkHttpClient.Builder()
                .connectTimeout(6, TimeUnit.SECONDS)
                .readTimeout(15, TimeUnit.SECONDS)
                .writeTimeout(15, TimeUnit.SECONDS)
                .build()
            return Retrofit.Builder()
                .baseUrl(cleanUrl)
                .client(client)
                .addConverterFactory(GsonConverterFactory.create())
                .build()
                .create(LocalApiService::class.java)
        }
    }
}
