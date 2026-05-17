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
}

final class APIClient {
    var baseURL = URL(string: "http://localhost:8787")!

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
        request.addValue(session.userId, forHTTPHeaderField: "x-user-id")
        request.addValue(session.email, forHTTPHeaderField: "x-user-email")
        request.addValue(session.roles.joined(separator: ","), forHTTPHeaderField: "x-user-roles")
        if let body {
            request.httpBody = try JSONEncoder().encode(body)
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
