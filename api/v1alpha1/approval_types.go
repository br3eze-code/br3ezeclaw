package v1alpha1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type ApprovalSpec struct {
	Tool string `json:"tool"`
	Args string `json:"args"` // JSON string
	User string `json:"user"`
	Reason string `json:"reason,omitempty"`
}

type ApprovalStatus struct {
	State string `json:"state,omitempty"` // Pending, Approved, Denied
	DecidedBy string `json:"decidedBy,omitempty"`
	DecidedAt *metav1.Time `json:"decidedAt,omitempty"`
	Result string `json:"result,omitempty"`
}

//+kubebuilder:object:root=true
//+kubebuilder:subresource:status
//+kubebuilder:printcolumn:name="Tool",type=string,JSONPath=`.spec.tool`
//+kubebuilder:printcolumn:name="User",type=string,JSONPath=`.spec.user`
//+kubebuilder:printcolumn:name="State",type=string,JSONPath=`.status.state`
//+kubebuilder:printcolumn:name="Age",type=date,JSONPath=`.metadata.creationTimestamp`

type Approval struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`
	Spec ApprovalSpec `json:"spec,omitempty"`
	Status ApprovalStatus `json:"status,omitempty"`
}

//+kubebuilder:object:root=true
type ApprovalList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items []Approval `json:"items"`
}

func init() {
	SchemeBuilder.Register(&Approval{}, &ApprovalList{})
}
