import Foundation

enum UserMode: String, CaseIterable, Identifiable {
    case applicant
    case admin

    var id: String { rawValue }
}

struct Session {
    let userId: String
    let email: String
    let roles: [String]
    let token: String
    let expiresAt: String
}

struct AuthResponse: Decodable {
    let token: String
    let expiresAt: String
    let user: AuthUser
}

struct AuthUser: Decodable {
    let userId: String
    let email: String
    let roles: [String]
}

final class APIClient {
    var baseURL = URL(string: "http://localhost:8787")!

    func login(email: String, password: String) async throws -> Session {
        let response: AuthResponse = try await authRequest(path: "/auth/login", email: email, password: password)
        return Session(userId: response.user.userId, email: response.user.email, roles: response.user.roles, token: response.token, expiresAt: response.expiresAt)
    }

    func registerApplicant(email: String, password: String) async throws -> Session {
        let response: AuthResponse = try await authRequest(path: "/auth/register", email: email, password: password)
        return Session(userId: response.user.userId, email: response.user.email, roles: response.user.roles, token: response.token, expiresAt: response.expiresAt)
    }

    func listApplicantSubmissions(session: Session) async throws -> [SubmissionRecord] {
        try await request(path: "/submissions", session: session)
    }

    func listAdminSubmissions(session: Session) async throws -> [SubmissionRecord] {
        try await request(path: "/admin/submissions", session: session)
    }

    func createSubmission(session: Session, draft: SubmissionDraft) async throws -> SubmissionRecord {
        try await request(path: "/submissions", method: "POST", session: session, body: draft)
    }

    func overrideSubmission(session: Session, submissionId: String, status: DecisionStatus, reason: String) async throws -> SubmissionRecord {
        let body = ["status": status.rawValue, "reason": reason]
        return try await request(path: "/admin/submissions/\(submissionId)/override", method: "POST", session: session, body: body)
    }

    private func request<T: Decodable, Body: Encodable>(
        path: String,
        method: String = "GET",
        session: Session,
        body: Body? = Optional<String>.none
    ) async throws -> T {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = method
        request.addValue("application/json", forHTTPHeaderField: "content-type")
        request.addValue("Bearer \(session.token)", forHTTPHeaderField: "authorization")
        if let body {
            request.httpBody = try JSONEncoder().encode(body)
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func authRequest<T: Decodable>(path: String, email: String, password: String) async throws -> T {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = "POST"
        request.addValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try JSONEncoder().encode(["email": email, "password": password])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.userAuthenticationRequired)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
