#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const env = process.env;
const awsRegion = env.AWS_REGION || "us-east-2";
const profile = env.AWS_PROFILE;
const domain = env.CUSTOM_DOMAIN || "cola-mail-sandbox-2026.xyz";
const zoneId = (env.ROUTE53_HOSTED_ZONE_ID || findHostedZone(domain)).replace(/^\/hostedzone\//, "");
const webDistributionId = required("DEPLOYED_CLOUDFRONT_DISTRIBUTION_ID");
const apiDistributionId = required("DEPLOYED_API_CLOUDFRONT_DISTRIBUTION_ID");
const webAliases = unique([domain, `www.${domain}`, env.CUSTOM_APP_DOMAIN || `app.${domain}`]);
const apiAliases = unique([env.CUSTOM_API_DOMAIN || `api.${domain}`]);
const allAliases = unique([...webAliases, ...apiAliases]);
const cloudFrontHostedZoneId = "Z2FDTNDATAQYW2";

console.log(`Using Route 53 zone ${zoneId} for ${domain}.`);
const certificateArn = ensureCertificate(allAliases);
console.log(`Using ACM certificate ${certificateArn}.`);

const webDistribution = updateDistribution(webDistributionId, webAliases, certificateArn);
const apiDistribution = updateDistribution(apiDistributionId, apiAliases, certificateArn);
upsertAliasRecords(webAliases, webDistribution.DomainName);
upsertAliasRecords(apiAliases, apiDistribution.DomainName);

console.log(
  JSON.stringify(
    {
      webUrls: webAliases.map((alias) => `https://${alias}`),
      apiUrls: apiAliases.map((alias) => `https://${alias}`),
      certificateArn,
      webDistributionId,
      apiDistributionId
    },
    null,
    2
  )
);

function ensureCertificate(names) {
  const reusable = findReusableCertificate(names);
  if (reusable?.Status === "ISSUED") return reusable.CertificateArn;

  const arn =
    reusable?.CertificateArn ||
    aws([
      "acm",
      "request-certificate",
      "--region",
      "us-east-1",
      "--domain-name",
      names[0],
      "--subject-alternative-names",
      ...names.slice(1),
      "--validation-method",
      "DNS",
      "--idempotency-token",
      certificateToken(names),
      "--query",
      "CertificateArn",
      "--output",
      "text"
    ]).trim();

  upsertCertificateValidationRecords(arn);
  const described = describeCertificate(arn);
  if (described.Status !== "ISSUED") {
    console.log("Waiting for ACM DNS validation to issue the certificate...");
    aws(["acm", "wait", "certificate-validated", "--region", "us-east-1", "--certificate-arn", arn]);
  }
  return arn;
}

function findReusableCertificate(names) {
  const summaries = JSON.parse(
    aws([
      "acm",
      "list-certificates",
      "--region",
      "us-east-1",
      "--certificate-statuses",
      "PENDING_VALIDATION",
      "ISSUED",
      "--output",
      "json"
    ])
  ).CertificateSummaryList;
  for (const summary of summaries) {
    const cert = describeCertificate(summary.CertificateArn);
    const certNames = new Set([cert.DomainName, ...(cert.SubjectAlternativeNames || [])]);
    if (names.every((name) => certNames.has(name)) && ["ISSUED", "PENDING_VALIDATION"].includes(cert.Status)) {
      return cert;
    }
  }
  return undefined;
}

function describeCertificate(arn) {
  return JSON.parse(
    aws(["acm", "describe-certificate", "--region", "us-east-1", "--certificate-arn", arn, "--output", "json"])
  ).Certificate;
}

function upsertCertificateValidationRecords(arn) {
  let cert = describeCertificate(arn);
  for (let attempt = 0; attempt < 20; attempt++) {
    const records = (cert.DomainValidationOptions || []).map((option) => option.ResourceRecord).filter(Boolean);
    if (records.length > 0) {
      const changes = records.map((record) => ({
        Action: "UPSERT",
        ResourceRecordSet: {
          Name: record.Name,
          Type: record.Type,
          TTL: 300,
          ResourceRecords: [{ Value: record.Value }]
        }
      }));
      changeRecordSets(changes);
      return;
    }
    sleep(3000);
    cert = describeCertificate(arn);
  }
  throw new Error(`ACM did not provide DNS validation records for ${arn}.`);
}

function updateDistribution(distributionId, aliases, certificateArn) {
  const raw = JSON.parse(aws(["cloudfront", "get-distribution-config", "--id", distributionId, "--output", "json"]));
  const config = raw.DistributionConfig;
  config.Aliases = { Quantity: aliases.length, Items: aliases };
  config.ViewerCertificate = {
    ACMCertificateArn: certificateArn,
    SSLSupportMethod: "sni-only",
    MinimumProtocolVersion: "TLSv1.2_2021",
    CertificateSource: "acm"
  };
  const configFile = join(tmpdir(), `cloudfront-${distributionId}-${Date.now()}.json`);
  writeFileSync(configFile, JSON.stringify(config));
  const updated = JSON.parse(
    aws([
      "cloudfront",
      "update-distribution",
      "--id",
      distributionId,
      "--if-match",
      raw.ETag,
      "--distribution-config",
      `file://${configFile}`,
      "--output",
      "json"
    ])
  ).Distribution;
  console.log(`Updated CloudFront distribution ${distributionId} aliases: ${aliases.join(", ")}.`);
  return updated;
}

function upsertAliasRecords(names, distributionDomainName) {
  const changes = names.flatMap((name) =>
    ["A", "AAAA"].map((type) => ({
      Action: "UPSERT",
      ResourceRecordSet: {
        Name: name,
        Type: type,
        AliasTarget: {
          HostedZoneId: cloudFrontHostedZoneId,
          DNSName: distributionDomainName,
          EvaluateTargetHealth: false
        }
      }
    }))
  );
  changeRecordSets(changes);
}

function changeRecordSets(changes) {
  const changeFile = join(tmpdir(), `route53-change-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  writeFileSync(changeFile, JSON.stringify({ Changes: changes }));
  aws(["route53", "change-resource-record-sets", "--hosted-zone-id", zoneId, "--change-batch", `file://${changeFile}`]);
}

function findHostedZone(name) {
  const response = JSON.parse(
    aws(["route53", "list-hosted-zones-by-name", "--dns-name", name, "--output", "json"])
  );
  const zone = response.HostedZones?.find((candidate) => candidate.Name === `${name}.` && !candidate.Config?.PrivateZone);
  if (!zone) throw new Error(`No public hosted zone found for ${name}.`);
  return zone.Id;
}

function aws(args) {
  const fullArgs = [...args];
  if (profile && !fullArgs.includes("--profile")) fullArgs.push("--profile", profile);
  return execFileSync("aws", fullArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function required(name) {
  const value = env[name];
  if (!value) throw new Error(`${name} must be set.`);
  return value;
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function certificateToken(names) {
  return names
    .join("-")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 32);
}
