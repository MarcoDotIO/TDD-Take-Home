import Foundation

enum DecisionStatus: String, Codable, CaseIterable, Identifiable {
    case approved
    case needsReview = "needs_review"
    case rejected

    var id: String { rawValue }
}

struct ColaImage: Codable, Identifiable {
    let id: String
    var localPath: String?
    var position: String?
}

struct ColaSubmission: Codable, Identifiable {
    let id: String
    let applicantId: String
    let applicantEmail: String
    let brandName: String
    let productName: String
    let productType: String
    let className: String
    let originName: String
    let domesticOrImported: String
    let abv: Double?
    let volume: Double?
    let volumeUnit: String?
    let images: [ColaImage]
    let submittedAt: String
    let status: String
}

struct AutomationDecision: Codable {
    let status: DecisionStatus
    let confidence: Double
    let rationale: String
    let evidence: [DecisionEvidence]
}

struct DecisionEvidence: Codable, Identifiable {
    var id: String { field + message }
    let field: String
    let severity: String
    let message: String
}

struct SubmissionRecord: Codable, Identifiable {
    var id: String { submission.id }
    let submission: ColaSubmission
    let decision: AutomationDecision?
    let overrides: [AdminOverride]
}

struct AdminOverride: Codable {
    let adminId: String
    let status: DecisionStatus
    let reason: String
    let createdAt: String
}

struct SubmissionDraft: Encodable {
    let brandName: String
    let productName: String
    let productType: String
    let className: String
    let originName: String
    let domesticOrImported: String
    let abv: Double?
    let volume: Double?
    let volumeUnit: String?
    let images: [ColaImage]
}
